#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/agent"
NODE_RUNNER="${SCRIPT_DIR}/run-node.sh"
ACTION="${1:-dev}"

cd "${APP_DIR}"

case "${ACTION}" in
  dev)
    export AGENT_PORT="${AGENT_PORT:-3012}"
    exec "${NODE_RUNNER}" ./node_modules/tsx/dist/cli.mjs src/index.ts
    ;;
  build)
    exec "${NODE_RUNNER}" ./node_modules/typescript/bin/tsc
    ;;
  start)
    export AGENT_PORT="${AGENT_PORT:-3012}"
    exec "${NODE_RUNNER}" dist/index.js
    ;;
  test)
    exec "${NODE_RUNNER}" ./node_modules/vitest/vitest.mjs run
    ;;
  test:watch)
    exec "${NODE_RUNNER}" ./node_modules/vitest/vitest.mjs
    ;;
  test:agent)
    exec "${NODE_RUNNER}" ./node_modules/tsx/dist/cli.mjs src/test-agent.ts
    ;;
  *)
    echo "Unknown action: ${ACTION}" >&2
    exit 1
    ;;
esac
