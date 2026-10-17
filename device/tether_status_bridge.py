#!/usr/bin/env python3
# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# TETHER change notice: Adapted and modified for sanitized TETHER run-state
# updates. Changes include loopback-only API polling, status allowlisting,
# durable state tracking, and omission of task prompts and reply text.
# Derived from linux/examples/pebble_ring_bridge.py in
# facebookincubator/muse-gadget-sdk at f60347aeb851a1fe9438cfc388721776aa24f275.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Send short, redacted TETHER run-state updates through a local device CLI.

The bridge reads the local TETHER API on the same Linux host and sends only
an allowlisted status label and short run identifier. It never includes task
prompts, Fo replies, event summaries, or credentials. State is recorded after
each successful send to reduce duplicate notices after restart.

Required environment:
  TETHER_DEVICE_SESSION_ID  stable side-chat identifier for notifications
Optional environment:
  TETHER_API_URL            loopback TETHER origin (default http://127.0.0.1:4173)
  TETHER_DEVICE_CLI          path to local device CLI (default musegadget)
  TETHER_DEVICE_STATE_FILE   private state path (default ~/.local/state/tether-device/state.json)
  TETHER_DEVICE_POLL_SECONDS polling interval (default 15, range 2..300)

The API must run on this same host because TETHER binds to loopback only.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import time
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

log = logging.getLogger("tether-device-bridge")

MAX_RESPONSE_BYTES = 4 * 1024 * 1024
SEND_TIMEOUT_S = 90
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
STATUS_LABELS = {
    "draft": "Draft saved locally",
    "dispatching": "Request sent; awaiting a report",
    "working": "In progress per the connected service",
    "waiting_for_user": "Needs your input",
    "completed_fo_reported": "The connected service reported completion; not independently verified",
    "failed_fo_reported": "The connected service reported failure",
    "connection_interrupted": "Connection interrupted",
    "outcome_unknown": "Outcome unknown; TETHER will not retry automatically",
    "locally_stopped_observing": "TETHER stopped observing; the connected service may still be working",
}
RUN_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def validate_api_url(value: str) -> str:
    """Accept only a plain loopback origin to prevent sending private data off-host."""
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname not in LOOPBACK_HOSTS:
        raise ValueError("TETHER_API_URL must be an http loopback origin")
    if parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("TETHER_API_URL must be a bare loopback origin")
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError("TETHER_API_URL has an invalid port")
    return value.rstrip("/")


def fetch_runs(api_url: str, *, opener=urlopen) -> list[dict]:
    request = Request(f"{validate_api_url(api_url)}/api/runs", headers={"Accept": "application/json"})
    with opener(request, timeout=10) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("TETHER API response is too large")
    data = json.loads(raw)
    runs = data.get("runs") if isinstance(data, dict) else None
    if not isinstance(runs, list):
        raise ValueError("TETHER API response has no run list")
    result = []
    for run in runs:
        if not isinstance(run, dict):
            continue
        run_id, status = run.get("id"), run.get("status")
        if isinstance(run_id, str) and RUN_ID.fullmatch(run_id) and isinstance(status, str):
            result.append({"id": run_id, "status": status})
    return result


def format_notice(run: dict) -> str | None:
    """Build a minimal notification; unknown status labels are never echoed."""
    label = STATUS_LABELS.get(run.get("status"))
    run_id = run.get("id")
    if not label or not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
        return None
    return f"TETHER run {run_id[:8]}: {label}. Open TETHER locally for details."


def send_notice(text: str, *, session_id: str, cli: str, runner=subprocess.run) -> tuple[bool, str]:
    command = [cli, "send-user-msg", "--session-id", session_id, "-"]
    try:
        result = runner(command, input=text, text=True, capture_output=True, timeout=SEND_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)
    detail = (result.stdout or result.stderr or "").strip()
    return result.returncode == 0, detail


class StateFile:
    """Small atomic state file containing only run IDs and status labels."""

    def __init__(self, filename: str | Path):
        self.path = Path(filename).expanduser()

    def load(self) -> dict[str, str]:
        try:
            raw = self.path.read_text(encoding="utf-8")
            value = json.loads(raw)
        except FileNotFoundError:
            return {}
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"cannot read state file: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError("state file must contain an object")
        return {
            run_id: status for run_id, status in value.items()
            if isinstance(run_id, str) and RUN_ID.fullmatch(run_id) and isinstance(status, str)
        }

    def save(self, statuses: dict[str, str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(json.dumps(statuses, sort_keys=True), encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(self.path)
        os.chmod(self.path, 0o600)


def process_snapshot(runs: list[dict], previous: dict[str, str], *, send, save) -> dict[str, str]:
    """Send changed statuses in newest-first input order; persist only successful sends."""
    for run in runs:
        run_id, status = run["id"], run["status"]
        if previous.get(run_id) == status:
            continue
        message = format_notice(run)
        if message is None:
            continue
        delivered, detail = send(message)
        if not delivered:
            log.warning("status update for %s was not sent: %s", run_id[:8], detail)
            continue
        previous[run_id] = status
        save(previous)
    # Only successful sends advance state. A failed send remains eligible for
    # retry on the next poll. Prior entries missing from the API response are
    # retained, so a temporarily hidden run is not mistaken for a new run.
    return previous


def run_forever(*, api_url: str, state: StateFile, session_id: str, cli: str, poll_seconds: int) -> None:
    validate_api_url(api_url)
    previous = state.load()
    initialized = bool(previous)
    while True:
        try:
            runs = fetch_runs(api_url)
            if not initialized:
                # Establish a baseline instead of notifying about old history.
                previous = {run["id"]: run["status"] for run in runs}
                state.save(previous)
                initialized = True
            else:
                previous = process_snapshot(
                    runs,
                    previous,
                    send=lambda text: send_notice(text, session_id=session_id, cli=cli),
                    save=state.save,
                )
        except (OSError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            log.warning("TETHER status check failed: %s", exc)
        time.sleep(poll_seconds)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    session_id = os.environ.get("TETHER_DEVICE_SESSION_ID", "").strip()
    if not session_id or len(session_id) > 128:
        raise SystemExit("Set TETHER_DEVICE_SESSION_ID to the stable private notification chat ID.")
    api_url = os.environ.get("TETHER_API_URL", "http://127.0.0.1:4173")
    state = StateFile(os.environ.get("TETHER_DEVICE_STATE_FILE", "~/.local/state/tether-device/state.json"))
    cli = os.environ.get("TETHER_DEVICE_CLI", "musegadget")
    try:
        poll_seconds = int(os.environ.get("TETHER_DEVICE_POLL_SECONDS", "15"))
    except ValueError as exc:
        raise SystemExit("TETHER_DEVICE_POLL_SECONDS must be an integer.") from exc
    if not 2 <= poll_seconds <= 300:
        raise SystemExit("TETHER_DEVICE_POLL_SECONDS must be from 2 to 300.")
    log.info("watching the local TETHER API every %d seconds", poll_seconds)
    run_forever(api_url=api_url, state=state, session_id=session_id, cli=cli, poll_seconds=poll_seconds)


if __name__ == "__main__":
    main()
