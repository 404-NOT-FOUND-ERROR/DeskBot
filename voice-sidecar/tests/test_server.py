import base64
import json
import pathlib
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from voice_sidecar.server import VoiceSidecar, create_server


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = create_server("127.0.0.1", 0, service=VoiceSidecar())
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        host, port = cls.httpd.server_address
        cls.base_url = f"http://{host}:{port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    @classmethod
    def request(cls, method, path, body=None):
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            cls.base_url + path,
            data=data,
            method=method,
            headers={"content-type": "application/json"} if data is not None else {},
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def test_health_and_capabilities(self):
        status, body = self.request("GET", "/v1/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        status, body = self.request("GET", "/api/capabilities")
        self.assertEqual(status, 200)
        self.assertIn("pcm_s16le", body["capabilities"]["asr"]["input_codecs"])
        self.assertIn("wav", body["capabilities"]["tts"]["output_codecs"])
        self.assertEqual(body["capabilities"]["audio"]["capture_formats"][0], {"codec": "pcm_s16le", "sample_rate_hz": 16000, "channels": 1})
        self.assertEqual(body["capabilities"]["audio"]["playback_formats"][0], {"codec": "wav", "sample_rate_hz": 16000, "channels": 1})

    def test_asr_partial_and_final_aliases(self):
        common = {
            "request_id": "req-asr-1",
            "correlation_id": "corr-asr-1",
            "utterance_id": "utt-asr-1",
            "text": "  你好   世界  ",
            "character_id": "ember-001",
        }
        status, partial = self.request("POST", "/v1/asr", {**common, "stage": "partial"})
        self.assertEqual(status, 200)
        self.assertEqual(partial["stage"], "partial")
        self.assertFalse(partial["is_final"])
        self.assertEqual(partial["raw_utterance"], "  你好   世界  ")
        self.assertEqual(partial["clean_utterance"], "你好 世界")
        self.assertEqual(partial["event_id"], "asr-req-asr-1-partial")
        self.assertEqual(partial["event"]["correlation_id"], "corr-asr-1")

        final = self.request("POST", "/api/asr", {**common, "request_id": "req-asr-2", "stage": "final"})[1]
        self.assertTrue(final["is_final"])
        self.assertEqual(final["event"]["type"], "voice.asr.final")
        self.assertEqual(final["event"]["payload"]["text"], "你好 世界")

    def test_tts_wav_and_pcm_metadata(self):
        request = {
            "request_id": "req-tts-1",
            "correlation_id": "corr-tts-1",
            "text": "测试语音",
            "profile": {"name": "ember", "speed": 1.0},
            "format": {"codec": "wav", "sample_rate_hz": 16000, "channels": 1},
        }
        status, body = self.request("POST", "/v1/tts", request)
        self.assertEqual(status, 200)
        payload = base64.b64decode(body["audio_b64"])
        self.assertEqual(payload[:4], b"RIFF")
        self.assertEqual(body["audio"]["byte_count"], len(payload))
        self.assertEqual(body["audio"]["format"]["codec"], "wav")
        self.assertEqual(base64.b64decode(body["audio"]["data_base64"]), payload)
        self.assertEqual(body["audio"]["codec"], "wav")
        self.assertEqual(body["audio"]["audio_id"], "audio-req-tts-1")
        self.assertEqual(body["audio_id"], body["audio"]["audio_id"])
        status, pcm = self.request("POST", "/api/tts", {**request, "request_id": "req-tts-2", "format": "pcm_s16le"})
        self.assertEqual(status, 200)
        pcm_payload = base64.b64decode(pcm["audio_b64"])
        self.assertGreater(len(pcm_payload), 4)
        self.assertEqual(len(pcm_payload) % 2, 0)
        self.assertEqual(pcm["audio"]["format"]["codec"], "pcm_s16le")

    def test_structured_validation_error_preserves_ids(self):
        status, body = self.request(
            "POST",
            "/v1/tts",
            {"request_id": "req-bad", "correlation_id": "corr-bad", "text": "x", "format": "opus"},
        )
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "unsupported_audio_format")
        self.assertEqual(body["request_id"], "req-bad")
        self.assertEqual(body["correlation_id"], "corr-bad")

    def test_timeout_and_cooperative_cancellation(self):
        status, body = self.request(
            "POST",
            "/v1/asr",
            {"request_id": "req-timeout", "correlation_id": "corr-timeout", "text": "x", "simulate_delay_ms": 50, "timeout_ms": 5},
        )
        self.assertEqual(status, 504)
        self.assertEqual(body["error"]["code"], "timeout")

        result = {}

        def slow_request():
            result["response"] = self.request(
                "POST",
                "/v1/tts",
                {"request_id": "req-cancel", "correlation_id": "corr-cancel", "text": "x", "simulate_delay_ms": 5000, "timeout_ms": 10000},
            )

        worker = threading.Thread(target=slow_request, daemon=True)
        worker.start()
        # Wait until the operation is visible, without relying on a fixed long
        # sleep.  The endpoint is local and the registry is intentionally tiny.
        for _ in range(100):
            if self.httpd.service.operations.is_active("req-cancel"):
                break
            time.sleep(0.005)
        cancel_status, cancel_body = self.request("POST", "/v1/jobs/req-cancel/cancel", {"correlation_id": "corr-cancel"})
        self.assertEqual(cancel_status, 200)
        self.assertTrue(cancel_body["cancelled"])
        worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertEqual(result["response"][0], 409)
        self.assertEqual(result["response"][1]["error"]["code"], "cancelled")

    def test_non_integer_simulation_delay_is_rejected(self):
        status, body = self.request(
            "POST",
            "/v1/asr",
            {"request_id": "req-float", "correlation_id": "corr-float", "text": "x", "simulate_delay_ms": 1.5},
        )
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "invalid_request")

    def test_unknown_route(self):
        status, body = self.request("GET", "/v1/nope")
        self.assertEqual(status, 404)
        self.assertEqual(body["error"]["code"], "not_found")


if __name__ == "__main__":
    unittest.main()
