# VPS Phase 1 Live Bridge

This stack now covers the real Asterisk phase 2 media path for the open-source BYOC rollout:

- `postgres` for shared runtime state
- `asterisk` for SIP, dialplan, and ARI call control
- `apps/agent` on the host for the Gemini session and the RTP external-media bridge

## What is working now

- inbound SIP calls can enter the `voice-agent` Stasis app through Asterisk
- outbound calls originated from `apps/agent` enter the same ARI flow when answered
- `apps/agent` creates an Asterisk mixing bridge plus an `externalMedia` channel per live call
- caller audio is forwarded to Gemini through RTP/UDP `ulaw` at 8 kHz
- synthesized Gemini audio is packetized back to Asterisk over RTP/UDP
- call teardown destroys the external media channel and bridge and ends the runtime call record
- Twilio and Plivo remain available as legacy adapters

## Current limitations

- the live bridge is `externalMedia` over RTP/UDP only
- the bridge format is fixed to `ulaw` at 8 kHz
- clearing output only drops unsent local RTP frames; audio already sent to Asterisk cannot be recalled
- if `ASTERISK_EXTERNAL_MEDIA_PORT` is set to a fixed port, only one live call can bind that port at a time; leave it at `0` for dynamic ports
- if `GEMINI_API_KEY` is missing, the Asterisk runtime rejects live calls instead of pretending the voice path is available

## Bring-up

1. Copy `ops/vps-phase1/.env.example` to `ops/vps-phase1/.env` and replace every placeholder secret with a random 32-plus character value.
2. Keep Postgres bound to `127.0.0.1:${POSTGRES_PORT:-5432}` unless you have a private network and firewall rule for database access. Do not expose Postgres publicly.
3. Before accepting public SIP traffic, restrict UDP `5060` and the configured RTP range to your SIP provider IPs or VPN at the VPS firewall.
4. Run `docker compose up --build -d` from `ops/vps-phase1`.
5. Copy `ops/vps-phase1/agent.env.example` into `apps/agent/.env` and fill in the real `GEMINI_API_KEY` and database password.
6. Keep `ASTERISK_EXTERNAL_MEDIA_HOST=127.0.0.1` when using the provided compose stack. The Asterisk service runs with `network_mode: host`, so ARI, SIP, and RTP stay on the VPS network stack instead of crossing Docker bridge NAT.
7. Install Node dependencies in the repo, then run `npm --prefix apps/agent run build`.
8. Start the agent on the host with `bash ./scripts/run-agent.sh start` or install a systemd unit under `/etc/systemd/system/`.
9. Check `http://127.0.0.1:3012/health/details` from a trusted shell. The Asterisk section must report the ARI websocket as connected before treating the live path as ready.

## Dialplan and media notes

- The inbound dialplan now enters `Stasis(...)` without answering first.
- The Node runtime answers the call only after the external-media transport is prepared.
- The compose stack keeps Asterisk in Docker with host networking and the agent on the host. ARI uses `127.0.0.1:8088` and the RTP bridge uses `127.0.0.1` for the external media target.
- The bundled `http.conf` binds ARI to `127.0.0.1` by default so the control surface stays local to the VPS.
- `TELEPHONY_PUBLIC_BASE_URL` is not required for the Asterisk path because inbound control comes from the ARI websocket, not an HTTP webhook callback.

## Smoke check

1. Confirm `docker compose ps` shows `postgres` and `asterisk` healthy enough to stay running.
2. Confirm `curl http://127.0.0.1:3012/health/details` reports `"provider":"asterisk"` when local dashboard token enforcement is disabled, or call it with a dashboard bearer token when enabled.
3. Place an inbound SIP call to the configured PJSIP endpoint or originate an outbound call from the dashboard.
4. Watch the agent log for `Asterisk ARI live bridge is connected and ready.` and a matching call record.
