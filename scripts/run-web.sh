#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/web"
NODE_RUNNER="${SCRIPT_DIR}/run-node.sh"
ACTION="${1:-dev}"

cd "${APP_DIR}"

case "${ACTION}" in
  dev)
    export NEXT_DIST_DIR="${NEXT_DIST_DIR:-.next-dev}"
    PORT="${PORT:-3011}"
    exec "${NODE_RUNNER}" ./node_modules/next/dist/bin/next dev -p "${PORT}"
    ;;
  build)
    rm -rf .next
    "${NODE_RUNNER}" ./node_modules/prisma/build/index.js generate
    exec "${NODE_RUNNER}" ./node_modules/next/dist/bin/next build
    ;;
  start)
    PORT="${PORT:-3011}"
    exec "${NODE_RUNNER}" ./node_modules/next/dist/bin/next start -p "${PORT}"
    ;;
  seed)
    exec "${NODE_RUNNER}" ./node_modules/tsx/dist/cli.mjs prisma/seed.ts
    ;;
  lint)
    exec "${NODE_RUNNER}" ./node_modules/typescript/bin/tsc --noEmit --pretty false
    ;;
  test)
    exec "${NODE_RUNNER}" --import tsx --test src/**/*.test.ts
    ;;
  *)
    echo "Unknown action: ${ACTION}" >&2
    exit 1
    ;;
esac
