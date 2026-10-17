import io
import json
import os
import tempfile
import unittest
from pathlib import Path

from tether_status_bridge import StateFile, fetch_runs, format_notice, process_snapshot, validate_api_url


class DeviceBridgeTests(unittest.TestCase):
    def test_only_loopback_http_origins_are_accepted(self):
        self.assertEqual(validate_api_url("http://127.0.0.1:4173/"), "http://127.0.0.1:4173")
        self.assertEqual(validate_api_url("http://localhost"), "http://localhost")
        for value in (
            "https://example.com",
            "http://example.com",
            "http://127.0.0.1:4173/path",
            "http://user:pass@localhost:4173",
            "https://localhost",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_api_url(value)

    def test_fetch_runs_rejects_non_loopback_before_opening(self):
        def forbidden(*args, **kwargs):
            raise AssertionError("network must not be opened")
        with self.assertRaises(ValueError):
            fetch_runs("http://example.com", opener=forbidden)

    def test_fetch_runs_keeps_only_run_ids_and_statuses(self):
        class Response(io.BytesIO):
            def __enter__(self):
                return self
            def __exit__(self, *args):
                self.close()
        def opener(request, timeout):
            self.assertEqual(request.full_url, "http://127.0.0.1:4173/api/runs")
            self.assertEqual(timeout, 10)
            return Response(json.dumps({"runs": [{
                "id": "run-1", "status": "working", "task": "private prompt",
                "lastFoResponse": "private reply", "events": [{"summary": "private"}],
            }, {"id": "invalid/id", "status": "working"}]}).encode())
        self.assertEqual(fetch_runs("http://127.0.0.1:4173", opener=opener),
                         [{"id": "run-1", "status": "working"}])

    def test_notice_is_redacted_and_allowlisted(self):
        message = format_notice({"id": "run-123456789", "status": "completed_fo_reported"})
        self.assertIn("run-1234", message)
        self.assertIn("not independently verified", message)
        self.assertNotIn("task", message.lower())
        self.assertIsNone(format_notice({"id": "run-1", "status": "secret user status"}))
        self.assertIsNone(format_notice({"id": "bad/id", "status": "working"}))

    def test_only_successful_sends_advance_saved_status(self):
        previous = {"run-1": "working"}
        runs = [
            {"id": "run-1", "status": "completed_fo_reported"},
            {"id": "run-2", "status": "working"},
        ]
        sent = []
        saved = []
        def send(text):
            sent.append(text)
            return (len(sent) == 1, "simulated failure")
        updated = process_snapshot(runs, previous, send=send, save=lambda state: saved.append(dict(state)))
        self.assertEqual(updated, {"run-1": "completed_fo_reported"})
        self.assertEqual(previous["run-2"] if "run-2" in previous else None, None)
        self.assertEqual(len(sent), 2)
        self.assertEqual(len(saved), 1)
        # The failed second message remains eligible for a later poll.
        process_snapshot(runs, updated, send=lambda text: (True, ""), save=lambda state: None)
        self.assertEqual(updated["run-2"], "working")

    def test_state_file_is_private_and_round_trips(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "nested" / "state.json"
            state = StateFile(path)
            state.save({"run-1": "working"})
            self.assertEqual(state.load(), {"run-1": "working"})
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text()), {"run-1": "working"})


if __name__ == "__main__":
    unittest.main()
