import unittest

import pipeline


class MaskStructureTest(unittest.TestCase):
    def test_masks_registered_values_in_nested_form_data(self):
        participant = {
            "name": "김철수",
            "phone": "010-1234-5678",
            "email": "test@example.com",
        }
        value = {
            "memo": "김철수와 통화했다.",
            "contacts": ["010-1234-5678", {"email": "test@example.com"}],
            "count": 2,
        }

        masked = pipeline.mask_structure(value, participant)

        self.assertEqual(masked["memo"], "[인명]와 통화했다.")
        self.assertEqual(masked["contacts"], ["[전화번호]", {"email": "[이메일]"}])
        self.assertEqual(masked["count"], 2)


if __name__ == "__main__":
    unittest.main()
