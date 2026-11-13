import io
import unittest
from unittest import mock

from ccc_pipeline import secure_memory
from ccc_pipeline.secure_memory import SecureMemoryError, SensitiveBuffer, load_sensitive_json


class SensitiveBufferTest(unittest.TestCase):
    def test_wipe_overwrites_the_owned_mapping(self):
        buffer = SensitiveBuffer(32)
        self.assertTrue(buffer.locked)
        view = buffer.view()
        view[:19] = b"RAW_SYNTHETIC_VALUE"
        buffer.wipe()
        self.assertEqual(bytes(view), b"\x00" * 32)
        view.release()
        buffer.close()

    def test_required_lock_failure_is_not_reported_as_locked_fallback(self):
        with mock.patch.object(secure_memory, "_lock_region", return_value=False):
            with self.assertRaises(SecureMemoryError):
                SensitiveBuffer(32)

    def test_json_reader_wipes_owned_mapping_and_parser_copy(self):
        wiped: dict[type, list[bytes]] = {}
        real_wipe = secure_memory._wipe_region

        def record_wipe(buffer):
            real_wipe(buffer)
            wiped.setdefault(type(buffer), []).append(bytes(buffer))

        value = "RAW_SYNTHETIC_VALUE" * 300
        with mock.patch.object(secure_memory, "_wipe_region", side_effect=record_wipe):
            parsed = load_sensitive_json(io.BytesIO(('{"value":"' + value + '"}').encode()))

        self.assertEqual(parsed, {"value": value})
        self.assertEqual(set(wiped), {secure_memory.mmap.mmap, bytearray})
        self.assertTrue(all(set(snapshot) <= {0} for copies in wiped.values() for snapshot in copies))

    def test_json_reader_refuses_to_read_into_unlocked_memory(self):
        stream = mock.Mock(wraps=io.BytesIO(b'{"value":"RAW_SYNTHETIC_VALUE"}'))
        with mock.patch.object(secure_memory, "_lock_region", return_value=False):
            with self.assertRaises(SecureMemoryError):
                load_sensitive_json(stream)
        stream.readinto.assert_not_called()


if __name__ == "__main__":
    unittest.main()
