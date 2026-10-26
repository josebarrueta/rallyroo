#!/usr/bin/env python3
"""Fail closed when a current XCTest source suite was not fully executed.

Accepts serial XCTest completion logs or `xcresulttool get test-results tests` JSON. Reports
identifiers/status only, not raw test output, device details or attachments.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sys


class VerificationError(ValueError):
    pass


def inventory(source):
    files = sorted(source.rglob("*.swift")) if source.is_dir() else [source]
    expected = []
    for file in files:
        text = file.read_text()
        # Current suites use XCTest, not parameterized Swift Testing. New styles
        # require an explicit inventory adapter, never a silent coverage loss.
        if re.search(r"^\s*@Test\b", text, re.MULTILINE):
            raise VerificationError("Swift Testing inventory requires an adapter")
        methods = re.findall(r"^\s*(?:public\s+|override\s+)?func\s+(test\w+)\s*\(\s*\)", text, re.MULTILINE)
        declared = set(re.findall(r"\bfunc\s+(test\w+)\s*\(", text))
        if declared - set(methods):
            raise VerificationError("Unsupported XCTest declaration needs an inventory adapter")
        if not methods:
            continue
        classes = re.findall(r"\bclass\s+(\w+)\s*:\s*(?:XCTest\.)?XCTestCase\b", text)
        if len(classes) != 1:
            raise VerificationError("Expected one XCTestCase class per test source file")
        expected.extend(f"{classes[0]}.{method}" for method in methods)
    if not expected or len(expected) != len(set(expected)):
        raise VerificationError("Source inventory is empty or contains duplicate tests")
    return set(expected)


def identifier(class_name, method):
    value = f"{class_name.rsplit('.', 1)[-1]}.{method.removesuffix('()')}"
    if not re.fullmatch(r"\w+\.test\w+", value):
        raise VerificationError("Unrecognized XCTest identifier")
    return value


def xctest_log_tests(text):
    # SwiftPM's parallel JUnit exporter can label XCTSkip as passed. Use actual
    # serial XCTest completion records instead, not aggregate summary counts or
    # the separate Swift Testing runner's misleading '0 tests passed' message.
    pattern = r"^Test Case '-\[([\w.]+) (test\w+)\]' (passed|failed|skipped)\b"
    return [(identifier(class_name, method), status.capitalize())
            for class_name, method, status in re.findall(pattern, text, re.MULTILINE)]


def xcresult_tests(text):
    report = json.loads(text)
    if not isinstance(report, dict) or not isinstance(report.get("testNodes"), list):
        raise VerificationError("Unrecognized xcresult test report")
    tests = []

    def walk(nodes):
        for node in nodes:
            if node.get("nodeType") == "Test Case":
                parts = node.get("nodeIdentifier", "").rsplit("/", 1)
                if len(parts) != 2:
                    raise VerificationError("Missing xcresult test identifier")
                tests.append((identifier(*parts), node.get("result", "Unknown")))
            walk(node.get("children", []))

    walk(report["testNodes"])
    return tests


def verify(expected, tests):
    counts = Counter(name for name, _ in tests)
    actual = set(counts)
    problems = {
        "missing": expected - actual,
        "unexpected": actual - expected,
        "duplicate": {name for name, count in counts.items() if count != 1},
        "not passed": {name for name, status in tests if status != "Passed"},
    }
    failures = [f"{kind}: {', '.join(sorted(names)[:8])}" for kind, names in problems.items() if names]
    if not tests or failures:
        raise VerificationError("; ".join(failures) or "No executed test cases")
    return len(tests)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--format", required=True, choices=["xctest-log", "xcresult"])
    parser.add_argument("--selection", type=Path, help="Optional explicit subset: one method name per line")
    args = parser.parse_args(argv)
    try:
        expected = inventory(args.source)
        if args.selection:
            methods = args.selection.read_text().splitlines()
            if not methods or any(not re.fullmatch(r"test\w+", name) for name in methods) or len(methods) != len(set(methods)):
                raise VerificationError("Selection must contain unique test method names")
            selected = {name for name in expected if name.split(".", 1)[1] in methods}
            if len(selected) != len(methods):
                raise VerificationError("Selection contains a missing or ambiguous source test")
            expected = selected
        text = args.report.read_text()
        tests = xctest_log_tests(text) if args.format == "xctest-log" else xcresult_tests(text)
        count = verify(expected, tests)
    except (OSError, ValueError, TypeError, AttributeError) as error:
        # Do not echo parser errors, file contents or provider-supplied output.
        message = str(error) if isinstance(error, VerificationError) else "Missing or malformed source/report"
        print(f"XCTest verification failed: {message}", file=sys.stderr)
        return 1
    print(f"Verified all {count} expected XCTest cases; none skipped, failed, duplicated or missing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
