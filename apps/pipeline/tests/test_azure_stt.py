import hashlib
import io
import json
import unittest
import urllib.error
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from ccc_pipeline import azure_stt
from ccc_pipeline.azure_stt import (
    AZURE_STT_ENDPOINT,
    AZURE_TOKEN_ENDPOINT,
    AzureSttError,
    preflight_azure,
    transcribe_azure,
)


class FakeResponse(io.BytesIO):
    def __init__(self, payload: bytes, status: int = 200):
        super().__init__(payload)
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()
        return False


class CapturingOpener:
    def __init__(self, response):
        self.response = response
        self.calls = []
        self.body = b""

    def open(self, request, timeout):
        self.calls.append((request, timeout))
        self.body = b"".join(request.data)
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


class AzureSttTest(unittest.TestCase):
    def audio_file(self, directory: str, content: bytes = b"synthetic audio") -> Path:
        path = Path(directory) / "audio.wav"
        path.write_bytes(content)
        return path

    def test_preflight_authenticates_against_korea_central_without_audio(self):
        opener = mock.Mock()
        opener.open.return_value = FakeResponse(b"short-lived-token")
        with mock.patch.object(azure_stt.urllib.request, "build_opener", return_value=opener):
            preflight_azure("fixture-key")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, AZURE_TOKEN_ENDPOINT)
        self.assertEqual(request.method, "POST")
        self.assertEqual(request.data, b"")
        self.assertEqual(request.get_header("Ocp-apim-subscription-key"), "fixture-key")
        self.assertNotIn("audio", request.headers)

    def test_streams_one_authorized_inline_korean_request_and_maps_milliseconds(self):
        payload = {
            "durationMilliseconds": 1800,
            "combinedPhrases": [{"text": "첫 문장 둘째 문장"}],
            "phrases": [
                {
                    "offsetMilliseconds": 125,
                    "durationMilliseconds": 375,
                    "text": "첫 문장",
                    "speaker": 1,
                },
                {
                    "offsetMilliseconds": 600,
                    "durationMilliseconds": 500,
                    "text": "둘째 문장",
                    "speaker": 0,
                },
            ],
        }
        opener = CapturingOpener(FakeResponse(json.dumps(payload).encode()))
        authorized = False

        def before_send():
            nonlocal authorized
            self.assertEqual(opener.calls, [])
            authorized = True

        with TemporaryDirectory() as tmp:
            path = self.audio_file(tmp)
            expected_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            with (
                mock.patch.object(azure_stt, "detect_silences", return_value=([], 1.8)),
                mock.patch.object(azure_stt.urllib.request, "build_opener", return_value=opener),
            ):
                result = transcribe_azure(
                    str(path),
                    api_key="fixture-key",
                    before_send=before_send,
                    expected_sha256=expected_hash,
                )

        self.assertTrue(authorized)
        self.assertEqual(len(opener.calls), 1)
        request, timeout = opener.calls[0]
        self.assertEqual(request.full_url, AZURE_STT_ENDPOINT)
        self.assertEqual(request.method, "POST")
        self.assertIn(b'filename="audio.bin"', opener.body)
        self.assertNotIn(b"audio.wav", opener.body)
        self.assertEqual(int(request.get_header("Content-length")), len(opener.body))
        self.assertEqual(request.get_header("Ocp-apim-subscription-key"), "fixture-key")
        self.assertIn(b'"locales":["ko-KR"]', opener.body)
        self.assertIn(b'"maxSpeakers":2', opener.body)
        self.assertNotIn(b"audioUrl", opener.body)
        self.assertIn(b"synthetic audio", opener.body)
        self.assertGreater(timeout, 0)
        self.assertEqual(
            [(s.start, s.end, s.speaker) for s in result.segments],
            [(0.125, 0.5, "SPEAKER_01"), (0.6, 1.1, "SPEAKER_00")],
        )

    def test_never_opens_network_when_authorization_or_preflight_fails(self):
        with TemporaryDirectory() as tmp:
            path = self.audio_file(tmp)
            opener = CapturingOpener(FakeResponse(b"{}"))
            with (
                mock.patch.object(azure_stt, "detect_silences", return_value=([], 1.0)),
                mock.patch.object(azure_stt.urllib.request, "build_opener", return_value=opener),
            ):
                with self.assertRaisesRegex(RuntimeError, "authorization denied"):
                    transcribe_azure(
                        str(path),
                        api_key="fixture-key",
                        before_send=mock.Mock(side_effect=RuntimeError("authorization denied")),
                    )
            self.assertEqual(opener.calls, [])

            before_send = mock.Mock()
            with mock.patch.object(azure_stt, "detect_silences", return_value=([], 7200.0)):
                with self.assertRaises(AzureSttError):
                    transcribe_azure(str(path), api_key="fixture-key", before_send=before_send)
            before_send.assert_not_called()

            with mock.patch.object(azure_stt, "detect_silences", return_value=([], 1.0)):
                with self.assertRaises(AzureSttError):
                    transcribe_azure(
                        str(path),
                        api_key="fixture-key",
                        before_send=before_send,
                        expected_sha256="0" * 64,
                    )
            before_send.assert_not_called()

            with mock.patch.object(azure_stt, "MAX_AUDIO_BYTES", path.stat().st_size):
                with self.assertRaises(AzureSttError):
                    transcribe_azure(str(path), api_key="fixture-key", before_send=before_send)
            before_send.assert_not_called()

    def test_provider_errors_are_sanitized_and_classified_without_retry(self):
        for status, transient in ((400, False), (429, True), (503, True)):
            with self.subTest(status=status), TemporaryDirectory() as tmp:
                path = self.audio_file(tmp)
                provider_error = urllib.error.HTTPError(
                    AZURE_STT_ENDPOINT,
                    status,
                    "provider leaked transcript secret",
                    None,
                    io.BytesIO(b'{"message":"raw transcript secret"}'),
                )
                opener = CapturingOpener(provider_error)
                with (
                    mock.patch.object(azure_stt, "detect_silences", return_value=([], 1.0)),
                    mock.patch.object(azure_stt.urllib.request, "build_opener", return_value=opener),
                ):
                    with self.assertRaises(AzureSttError) as caught:
                        transcribe_azure(str(path), api_key="fixture-key", before_send=lambda: None)
                self.assertEqual(len(opener.calls), 1)
                self.assertEqual(caught.exception.transient, transient)
                self.assertNotIn("secret", str(caught.exception))

        with TemporaryDirectory() as tmp:
            path = self.audio_file(tmp)
            opener = CapturingOpener(TimeoutError("raw timeout detail"))
            with (
                mock.patch.object(azure_stt, "detect_silences", return_value=([], 1.0)),
                mock.patch.object(azure_stt.urllib.request, "build_opener", return_value=opener),
            ):
                with self.assertRaises(AzureSttError) as caught:
                    transcribe_azure(str(path), api_key="fixture-key", before_send=lambda: None)
        self.assertTrue(caught.exception.transient)
        self.assertEqual(len(opener.calls), 1)
        self.assertNotIn("detail", str(caught.exception))

    def test_malformed_response_does_not_escape_raw_text(self):
        opener = CapturingOpener(FakeResponse(b'{"phrases":"raw transcript secret"}'))
        with TemporaryDirectory() as tmp:
            path = self.audio_file(tmp)
            with (
                mock.patch.object(azure_stt, "detect_silences", return_value=([], 1.0)),
                mock.patch.object(azure_stt.urllib.request, "build_opener", return_value=opener),
            ):
                with self.assertRaises(AzureSttError) as caught:
                    transcribe_azure(str(path), api_key="fixture-key", before_send=lambda: None)
        self.assertEqual(caught.exception.code, "malformed_response")
        self.assertNotIn("transcript", str(caught.exception))

    def test_rejects_phrase_timestamps_outside_recording(self):
        payload = {
            "durationMilliseconds": 1000,
            "phrases": [{
                "offsetMilliseconds": 2000, "durationMilliseconds": 1000,
                "text": "out-of-range transcript", "speaker": 0,
            }],
        }
        with self.assertRaises(AzureSttError):
            azure_stt._parse_result(payload)

    def test_existing_repetition_warning_is_applied_without_another_request(self):
        payload = {
            "durationMilliseconds": 4000,
            "phrases": [
                {
                    "offsetMilliseconds": index * 1000,
                    "durationMilliseconds": 900,
                    "text": "같은 문장",
                    "speaker": 0,
                }
                for index in range(4)
            ],
        }
        opener = CapturingOpener(FakeResponse(json.dumps(payload).encode()))
        with TemporaryDirectory() as tmp:
            path = self.audio_file(tmp)
            with (
                mock.patch.object(azure_stt, "detect_silences", return_value=([], 4.0)),
                mock.patch.object(azure_stt.urllib.request, "build_opener", return_value=opener),
            ):
                result = transcribe_azure(str(path), api_key="fixture-key", before_send=lambda: None)
        self.assertFalse(result.reliable)
        self.assertEqual(len(result.warnings), 1)
        self.assertEqual(len(opener.calls), 1)


if __name__ == "__main__":
    unittest.main()
