import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("xctest_results", Path(__file__).with_name("verify-xctest-results.py"))
results = importlib.util.module_from_spec(spec)
spec.loader.exec_module(results)


class XCTestResultsTests(unittest.TestCase):
    def test_complete_suite_passes(self):
        self.assertEqual(results.verify({"Suite.testOne"}, [("Suite.testOne", "Passed")]), 1)

    def test_empty_missing_extra_duplicate_and_nonpassing_cases_fail(self):
        expected = {"Suite.testOne"}
        for report in [[], [("Suite.testOther", "Passed")],
                       [("Suite.testOne", "Passed"), ("Suite.testExtra", "Passed")],
                       [("Suite.testOne", "Passed")] * 2,
                       [("Suite.testOne", "Skipped")], [("Suite.testOne", "Failed")],
                       [("Suite.testOne", "Unknown")]]:
            with self.subTest(report=report), self.assertRaises(results.VerificationError):
                results.verify(expected, report)

    def test_serial_xctest_records_preserve_real_skip_status_and_ignore_aggregate_counts(self):
        report = """Test Case '-[Module.Suite testOne]' started.
Test Case '-[Module.Suite testOne]' passed (0.1 seconds).
Test Case '-[Module.Suite testTwo]' skipped (0.1 seconds).
Test Case '-[Module.Suite testThree]' failed (0.1 seconds).
Executed 3 tests, with 0 failures
Test run with 0 tests passed
"""
        self.assertEqual(results.xctest_log_tests(report), [("Suite.testOne", "Passed"), ("Suite.testTwo", "Skipped"),
                                                           ("Suite.testThree", "Failed")])
        with self.assertRaises(results.VerificationError):
            results.verify({"Suite.testOne"}, results.xctest_log_tests('Test run with 0 tests passed'))

    def test_xcresult_nested_structure_and_identifiers(self):
        report = {"testNodes": [{"nodeType": "Test Plan", "children": [{
            "nodeType": "Test Case", "nodeIdentifier": "Suite/testOne()", "result": "Passed",
        }]}]}
        self.assertEqual(results.xcresult_tests(json.dumps(report)), [("Suite.testOne", "Passed")])
        report["testNodes"][0]["children"][0].pop("nodeIdentifier")
        with self.assertRaises(results.VerificationError):
            results.xcresult_tests(json.dumps(report))

    def test_unknown_xcresult_schema_is_not_an_empty_pass(self):
        with self.assertRaises(results.VerificationError):
            results.xcresult_tests('{"tests": []}')

    def test_inventory_tracks_new_methods_and_rejects_unsupported_or_duplicate_suites(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "Suite.swift"
            source.write_text('final class Suite: XCTestCase {\n func testOne() async throws {}\n func testTwo() {}\n}')
            self.assertEqual(results.inventory(source), {"Suite.testOne", "Suite.testTwo"})
            for text in ['struct Suite { @Test func example() {} }\n @Test func another() {}',
                         'final class Suite: XCTestCase {\n func testOne() {}\n func testOne() {}\n}',
                         'final class Suite: XCTestCase {}',
                         'class Suite: XCTestCase {\n @MainActor func testInlineAttribute() {}\n}',
                         'class Suite: XCTestCase {}\n class Another: XCTestCase {\n func testOne() {}\n}']:
                source.write_text(text)
                with self.assertRaises(results.VerificationError):
                    results.inventory(source)

    def test_selection_cli_and_unknown_missing_skipped_tests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, selection, report = [root / name for name in ("Suite.swift", "selection.txt", "report.json")]
            source.write_text('class Suite: XCTestCase {\n func testOne() {}\n func testTwo() {}\n}')
            selection.write_text('testOne\n')
            report.write_text(json.dumps({"testNodes": [{"nodeType": "Test Case",
                              "nodeIdentifier": "Suite/testOne()", "result": "Passed"}]}))
            args = ["--source", str(source), "--selection", str(selection), "--report", str(report), "--format", "xcresult"]
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(results.main(args), 0)
                for invalid in ['testMissing\n', 'testOne\ntestOne\n', '']:
                    selection.write_text(invalid)
                    self.assertEqual(results.main(args), 1)

    def test_malformed_reports_do_not_echo_sensitive_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, report = root / "Suite.swift", root / "report.json"
            source.write_text('class Suite: XCTestCase {\n func testOne() {}\n}')
            report.write_text('sensitive-fixture-output')
            errors = io.StringIO()
            with contextlib.redirect_stderr(errors):
                self.assertEqual(results.main(["--source", str(source), "--report", str(report), "--format", "xcresult"]), 1)
            self.assertNotIn('sensitive-fixture-output', errors.getvalue())


if __name__ == "__main__":
    unittest.main()
