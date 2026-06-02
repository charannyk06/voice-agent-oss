#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-/tmp/voice-agent-public}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

cd "$REPO_ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to export with uncommitted changes. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"

git archive --format=tar HEAD | tar -x -C "$TARGET_DIR"

python3 - "$TARGET_DIR" <<'PY'
import os
import re
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
local_only_dirs = {".git", ".next", ".next-dev", "node_modules", "coverage", "dist", "build", ".vercel", ".hermes", ".claude", "logs", "recordings", "transcripts", "uploads"}
blocked_suffixes = {".db", ".sqlite", ".sqlite3", ".pem", ".key", ".crt", ".cert", ".p12", ".pfx", ".tsbuildinfo"}
secret_patterns = [
    ("stripe_secret_key", re.compile(r"(?<![A-Za-z0-9])(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]{12,}")),
    ("stripe_webhook_secret", re.compile(r"whsec_[A-Za-z0-9]{12,}")),
    ("github_token", re.compile(r"gh[pousr]_[A-Za-z0-9_]{20,}")),
    ("google_api_key", re.compile(r"AIza[0-9A-Za-z_-]{10,}")),
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("credentialed_database_url", re.compile(r"(?:postgres(?:ql)?|mysql|mongodb)://[^\s:@]+:[^\s:@\[\]<>{}]+@", re.I)),
    ("stale_old_product_brand", re.compile(r"(?:con" r"ductor[-_\s]?oss|con" r"ductross|con" r"ductor|gen" r"eric[-_\s]?voice[-_\s]?agent|@gen" r"eric[-_]voice[-_]agent)", re.I)),
]

findings: list[str] = []

for path in root.rglob("*"):
    if not path.is_file():
        continue
    rel = path.relative_to(root).as_posix()
    parts = set(path.relative_to(root).parts)
    name = path.name
    suffix = path.suffix.lower()

    if parts.intersection(local_only_dirs):
        findings.append(f"local_only_path:{rel}")
        continue
    if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
        findings.append(f"env_file:{rel}")
        continue
    if suffix in blocked_suffixes:
        findings.append(f"sensitive_artifact:{rel}")
        continue

    if path.stat().st_size > 1_000_000:
        continue
    try:
        data = path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue
    if "\0" in data:
        continue
    for line_no, line in enumerate(data.splitlines(), 1):
        for label, pattern in secret_patterns:
            if pattern.search(line):
                findings.append(f"{label}:{rel}:{line_no}")

if findings:
    print("Export contains local-only artifacts or credential-shaped values.", file=sys.stderr)
    for finding in findings[:80]:
        print(finding, file=sys.stderr)
    sys.exit(1)
PY

echo "Clean public export created at: $TARGET_DIR"
