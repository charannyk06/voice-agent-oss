FROM debian:bookworm-slim

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    asterisk \
    asterisk-config \
    gettext-base \
  && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/asterisk-entrypoint.sh
COPY templates /opt/asterisk-templates

RUN chmod +x /usr/local/bin/asterisk-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/asterisk-entrypoint.sh"]
CMD ["asterisk", "-f", "-vvv"]
