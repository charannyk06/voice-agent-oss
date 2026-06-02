#!/usr/bin/env bash
set -euo pipefail

cd /opt/voice-agent

exec bash ./scripts/run-agent.sh start
