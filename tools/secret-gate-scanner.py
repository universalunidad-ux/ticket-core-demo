#!/usr/bin/env python3
"""Standard-library fallback scanner for tools/secret-gate.sh.

Exit codes intentionally follow grep/ripgrep semantics:
  0: at least one match
  1: scan completed with no matches
  2: scanner/configuration/read failure
"""

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Iterator, List, Pattern, Tuple


EXCLUDED_DIRS = {".git", "node_modules"}
EXCLUDED_FILES = {
    "tools/secret-gate.sh",
    "tools/secret-gate-scanner.py",
    "tools/secret-gate-patterns.txt",
}


def fail(message: str) -> int:
    print(f"secret-gate-scanner: {message}", file=sys.stderr)
    return 2


def load_patterns(path: Path) -> List[Pattern[str]]:
    raw_patterns = [line for line in path.read_text(encoding="utf-8").splitlines() if line]
    translated = [
        pattern.replace("[:space:]", r"\s").replace("[:cntrl:]", r"\x00-\x1f\x7f")
        for pattern in raw_patterns
    ]
    return [re.compile(pattern) for pattern in translated]


def is_binary(data: bytes) -> bool:
    sample = data[:8192]
    if b"\x00" in sample:
        return True
    if not sample:
        return False
    allowed_controls = {8, 9, 10, 12, 13}
    controls = sum(byte < 32 and byte not in allowed_controls for byte in sample)
    return controls / len(sample) > 0.30


def files_under(root: Path) -> Iterator[Tuple[Path, str]]:
    for current, dirs, files in os.walk(root, topdown=True, followlinks=False):
        dirs[:] = sorted(
            name
            for name in dirs
            if name not in EXCLUDED_DIRS and not (Path(current) / name).is_symlink()
        )
        for name in sorted(files):
            path = Path(current) / name
            if path.is_symlink() or name.endswith(".example") or ".example." in name:
                continue
            relative = path.relative_to(root).as_posix()
            if relative in EXCLUDED_FILES:
                continue
            yield path, relative


def scan(root: Path, patterns: List[Pattern[str]]) -> bool:
    found = False
    for path, relative in files_under(root):
        with path.open("rb") as binary_file:
            sample = binary_file.read(8192)
        if is_binary(sample):
            continue
        with path.open("r", encoding="utf-8", errors="replace") as text_file:
            for line_number, line in enumerate(text_file, start=1):
                if not any(pattern.search(line) for pattern in patterns):
                    continue
                print(f"{relative}:{line_number}: secret-shaped value detected")
                found = True
                break
    return found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--patterns", required=True, type=Path)
    parser.add_argument("--mode", required=True, choices=("secrets", "publishable"))
    parser.add_argument("root", type=Path)
    args = parser.parse_args()

    try:
        root = args.root.resolve(strict=True)
        if not root.is_dir():
            return fail(f"scan root is not a directory: {root}")
        patterns = (
            load_patterns(args.patterns)
            if args.mode == "secrets"
            else [re.compile(r"sb_publishable_")]
        )
        return 0 if scan(root, patterns) else 1
    except (OSError, UnicodeError, re.error) as error:
        return fail(str(error))


if __name__ == "__main__":
    sys.exit(main())
