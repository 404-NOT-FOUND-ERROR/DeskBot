import base64
import pathlib
import sys
import unittest

# Keep the tests runnable both from ``voice-sidecar`` and repository root.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from voice_sidecar.protocol import (
    ProtocolError,
    asr_input,
    clean_utterance,
    error_body,
    make_asr_event,
    normalize_audio_format,
    tts_input,
)


class ProtocolTests(unittest.TestCase):
    def test_cleanup_is_conservative_and_deterministic(self):
        self.assertEqual(clean_utterance("\ufeff  A\u200b   B  "), "A B")

    def test_asr_preserves_raw_and_builds_event(self):
        fields = asr_input(
            {
                "request_id": "req-1",
                "correlation_id": "corr-1",
                "stage": "partial",
                "text": "  今天   好吗  ",
                "utterance_id": "utt-1",
            }
        )
        self.assertEqual(fields["raw_utterance"], "  今天   好吗  ")
        self.assertEqual(fields["clean_utterance"], "今天 好吗")
        self.assertFalse(fields["is_final"])
        event = make_asr_event(fields, occurred_at="2026-09-01T00:00:00Z")
        self.assertEqual(event["type"], "voice.asr.partial")
        self.assertEqual(event["correlation_id"], "corr-1")
        self.assertEqual(event["payload"]["raw_utterance"], "  今天   好吗  ")

    def test_audio_only_is_explicit_fake_marker(self):
        fields = asr_input(
            {
                "correlation_id": "corr-audio",
                "audio_b64": base64.b64encode(b"pc").decode("ascii"),
                "audio_format": {"codec": "pcm_s16le", "sample_rate_hz": 16000, "channels": 1},
            }
        )
        self.assertTrue(fields["raw_utterance"].startswith("[fake-audio:"))
        self.assertEqual(fields["audio"]["byte_count"], 2)

    def test_empty_raw_hint_with_even_pcm_uses_explicit_fake_marker(self):
        fields = asr_input(
            {
                "correlation_id": "corr-empty-raw-audio",
                "raw_utterance": "",
                "audio_b64": base64.b64encode(b"\x00\x00").decode("ascii"),
                "audio_format": {"codec": "pcm_s16le", "sample_rate_hz": 16000, "channels": 1},
            }
        )
        self.assertTrue(fields["raw_utterance"].startswith("[fake-audio:"))
        self.assertEqual(fields["audio"]["format"]["codec"], "pcm_s16le")
        self.assertEqual(fields["audio"]["byte_count"], 2)

    def test_rejects_invalid_format_and_empty_input(self):
        with self.assertRaises(ProtocolError) as context:
            normalize_audio_format("opus", direction="playback", default_codec="wav")
        self.assertEqual(context.exception.code, "unsupported_audio_format")
        with self.assertRaises(ProtocolError) as context:
            asr_input({"correlation_id": "corr-empty"})
        self.assertEqual(context.exception.code, "missing_input")
        with self.assertRaises(ProtocolError) as context:
            asr_input({"correlation_id": "corr-audio-bad", "audio_b64": "%%%"})
        self.assertEqual(context.exception.code, "invalid_audio")
        with self.assertRaises(ProtocolError) as context:
            asr_input({"correlation_id": "corr-confidence", "text": "x", "confidence": True})
        self.assertEqual(context.exception.code, "invalid_confidence")

    def test_tts_accepts_profile_object_and_pcm_format(self):
        fields = tts_input(
            {
                "request_id": "req-tts",
                "correlation_id": "corr-tts",
                "text": "hello",
                "profile": {"name": "ember", "speed": 1.1},
                "format": {"codec": "pcm_s16le", "sample_rate_hz": 16000, "channels": 1},
            }
        )
        self.assertEqual(fields["profile"]["name"], "ember")
        self.assertEqual(fields["format"]["codec"], "pcm_s16le")

    def test_tts_omitted_profile_uses_canonical_shaping_profile(self):
        fields = tts_input({"request_id": "req-default-profile", "correlation_id": "corr-default-profile", "text": "hello"})
        self.assertEqual(fields["profile"], "shaping-neutral")

    def test_g711a_defaults_to_contract_rate(self):
        fields = asr_input(
            {
                "correlation_id": "corr-g711a",
                "text": "legacy",
                "format": {"codec": "g711a", "channels": 1},
            }
        )
        self.assertEqual(fields["format"], {"codec": "g711a", "sample_rate_hz": 8000, "channels": 1})

    def test_error_envelope_is_structured(self):
        body = error_body(ProtocolError(422, "bad_schema", "invalid"), request_id="req", correlation_id="corr")
        self.assertEqual(body["schema"], "voice.error.v0.1")
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"]["code"], "bad_schema")


if __name__ == "__main__":
    unittest.main()
