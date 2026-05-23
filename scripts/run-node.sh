#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: run-node.sh <script-or-js-file> [args...]" >&2
  exit 1
fi

if [[ -n "${VOICE_AGENT_NODE_BIN:-}" && -x "${VOICE_AGENT_NODE_BIN}" ]]; then
  exec "${VOICE_AGENT_NODE_BIN}" "$@"
fi

for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do
  if [[ -n "${candidate}" && -x "${candidate}" ]]; then
    exec "${candidate}" "$@"
  fi
done

echo "Unable to find a usable node binary" >&2
exit 1
