import json
import unittest
from pathlib import Path

from lean_format import LeanParseError, decode, dumps, encode, loads


class LeanApiTests(unittest.TestCase):
    def test_shared_roundtrip_and_golden_fixtures(self):
        root = Path(__file__).resolve().parents[2]
        cases = json.loads((root / "fixtures/roundtrip.json").read_text())
        for value in cases:
            self.assertEqual(decode(encode(value)), value)
            self.assertEqual(loads(dumps(value)), value)
        for case in json.loads((root / "fixtures/golden.json").read_text()):
            self.assertEqual(encode(case["value"]), case["lean"])
            self.assertEqual(decode(case["lean"]), case["value"])
            self.assertEqual(dumps(case["value"]), case["lean"])
            self.assertEqual(loads(case["lean"]), case["value"])

    def test_json_style_aliases(self):
        value = {"ok": True, "rows": [1, None]}
        self.assertIs(dumps, encode)
        self.assertIs(loads, decode)
        self.assertEqual(loads(dumps(value)), value)
        self.assertEqual(dumps(value), encode(value))

    def test_aliases_preserve_order_and_share_errors(self):
        value = {"z": 1, "a": 2}
        self.assertEqual(dumps(value), "z:1\na:2")
        self.assertEqual(list(loads(dumps(value))), ["z", "a"])
        with self.assertRaises(LeanParseError) as caught:
            loads("a:1\na:2")
        self.assertEqual((caught.exception.line, caught.exception.content), (2, "a:2"))

    def test_parse_error_has_line_and_content(self):
        with self.assertRaises(LeanParseError) as caught:
            decode("a:1\na:2")
        self.assertEqual(caught.exception.line, 2)
        self.assertEqual(caught.exception.content, "a:2")

    def test_non_string_object_keys_are_rejected(self):
        with self.assertRaises(ValueError):
            encode({1: "not a JSON object key"})
        with self.assertRaises(ValueError):
            encode({"nested": [{"also-invalid": {None: "no"}}]})

    def test_non_finite_numbers_are_rejected(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                encode({"value": value})


if __name__ == "__main__":
    unittest.main()
