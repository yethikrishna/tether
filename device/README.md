# TETHER device-ready code

This directory contains an optional Linux-side companion that reads TETHER's
local API and sends short run-status notices through a configured device
notification CLI. It is device-ready code, but has not been tested on physical
hardware. Do not infer compatibility with any particular device from this
code. It is not part of the TETHER web demo.

## Requirements

- Python 3.10 or newer; standard library only.
- TETHER's local backend running on the same Linux host at a loopback address.
  This integration uses only `GET /api/runs`; it does not dispatch, reply to,
  refresh, or stop tasks.
- A locally installed notification CLI whose `send-user-msg --session-id ID -`
  command accepts the message on stdin. Set `TETHER_DEVICE_CLI` to its path.
- A stable private notification-session ID in `TETHER_DEVICE_SESSION_ID`.

The bridge strictly restricts its API URL to plain HTTP on loopback. It sends
only an allowlisted status and a short run-ID prefix; prompts, replies, and
other run content stay local. First startup establishes a quiet baseline, so
existing runs do not trigger a burst of notifications. Changes are saved in a
mode-0600 state file after successful sends.

## Run

```sh
export TETHER_API_URL=http://127.0.0.1:4173
export TETHER_DEVICE_CLI=/path/to/your-device-notification-cli
export TETHER_DEVICE_SESSION_ID=your-private-session-id
python3 device/tether_status_bridge.py
```

Optional settings: `TETHER_DEVICE_STATE_FILE` chooses the private local state
file, and `TETHER_DEVICE_POLL_SECONDS` sets polling from 2 to 300 seconds
(default 15). Run it under a dedicated, unprivileged local account. The
notification CLI and its destination are separately configured by the owner.

## Host tests

```sh
python3 -m unittest discover -s device -p 'test_*.py'
```

These are host-side tests only, not hardware tests.
