#!/bin/sh
set -eu

mkdir -p /etc/asterisk

for template in /opt/asterisk-templates/*.template; do
  output="/etc/asterisk/$(basename "$template" .template)"
  envsubst < "$template" > "$output"
done

exec "$@"
