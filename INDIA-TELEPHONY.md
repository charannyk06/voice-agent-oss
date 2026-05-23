# India Telephony Setup

## Why Twilio was the wrong default
- The original voice agent assumed a Twilio number.
- That works for generic PSTN experiments, but it is a bad fit when callers in India need a local Indian number.
- For India inbound, the cleaner path is a provider that can issue Indian numbers and still expose live audio streaming.

## Chosen path
- Provider: Plivo
- Reason: supports India local-number rental workflows and bidirectional WebSocket audio streaming that matches this agent architecture.

## App support added
- `TELEPHONY_PROVIDER=plivo`
- Inbound answer webhook: `/webhook/plivo/answer`
- Status webhook: `/webhook/plivo/status`
- Media stream websocket: `/plivo-stream`
- Outbound call creation via Plivo REST API
- Dashboard settings API reports Twilio, Plivo, and Asterisk configuration state

## Required env vars
```bash
TELEPHONY_PROVIDER=plivo
PLIVO_AUTH_ID=
PLIVO_AUTH_TOKEN=
PLIVO_PHONE_NUMBER=+91XXXXXXXXXX
PLIVO_PUBLIC_BASE_URL=https://<public-agent-host>
PLIVO_ANSWER_PATH=/webhook/plivo/answer
PLIVO_STATUS_PATH=/webhook/plivo/status
# Optional override
PLIVO_MEDIA_STREAM_URL=wss://<public-agent-host>/plivo-stream
```

## Production checklist
1. Buy or provision an India number in Plivo
2. Complete provider KYC or local-number verification for India
3. Point the number's answer URL to `https://<agent-host>/webhook/plivo/answer`
4. Point the number's hangup or status callback to `https://<agent-host>/webhook/plivo/status`
5. Set `TELEPHONY_PROVIDER=plivo` in the agent environment
6. Set `AGENT_BASE_URL` for the dashboard to the public agent host
7. Validate inbound call, outbound call, dashboard live transcript, and end-state tracking

## Important note
- Buying an actual Indian number still requires carrier and provider approval, plus business verification. The code can be made ready here, but the final number assignment is controlled by the telephony provider.
