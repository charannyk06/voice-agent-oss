# Open Source BYOC Rearchitecture Plan

## Goal
Replace the Twilio and Plivo first telephony design with an open source, carrier-agnostic architecture that can run on a single VPS and accept customer numbers through SIP trunk, PBX routing, forwarding, or an on-prem gateway.

## Constraints
- Keep using a single VPS as phase 1 infrastructure.
- Do not require Twilio for the core path.
- Do not invent a fake phone-number layer. PSTN connectivity still comes from the customer's carrier, PBX, forwarding, or SIP trunk.
- Preserve the current dashboard, approvals, contacts, calls, knowledge docs, and live transcript UX.
- Keep Twilio and Plivo working as legacy adapters during migration.
- Use the same shared source of truth for dashboard and runtime.

## Phase 1 target architecture

```text
Customer Number
  -> SIP trunk / PBX route / call forwarding / on-prem gateway
  -> Asterisk on VPS
  -> ARI + audio bridge
  -> voice-agent Node runtime
  -> Gemini / STT / TTS
  -> Postgres shared state
  -> Next.js dashboard
```

## Chosen phase 1 components
- Telephony engine: Asterisk
- Call control integration: ARI
- App runtime: existing `apps/agent` service, reworked to be provider-agnostic
- Dashboard: existing `apps/web`
- Shared state: move toward Postgres-backed Prisma on VPS for multi-process safety
- Legacy fallback: keep Twilio and Plivo adapters behind the same provider interface

## Why Asterisk first
- simpler MVP than OpenSIPS or Kamailio plus RTPengine
- good fit for one-box VPS rollout
- handles inbound routing, forwarding, transfers, queues, extensions, and SIP trunks
- works with carrier SIP, PBX handoff, and on-prem gateways
- can be upgraded later with OpenSIPS or Kamailio in front when multi-tenant scale needs it

## Workstreams

### 1. Telephony abstraction in code
- replace the current monolithic `TelephonyService` with a provider interface
- keep `twilio` and `plivo` implementations as legacy adapters
- add `asterisk` provider implementation
- normalize inbound events, call control IDs, call status, outbound originate, and hangup across providers

### 2. Asterisk integration
- add Asterisk config and deployment assets under repo ops or docker paths
- configure PJSIP, dialplan, ARI app, and media bridge hooks
- support BYOC call entry paths:
  - direct SIP trunk
  - PBX route to SIP URI
  - forwarded DID
  - on-prem gateway into SIP trunk

### 3. Audio bridge into the agent
- keep the existing agent conversation brain
- add Asterisk audio ingestion and playback path
- map Asterisk call sessions to existing dashboard call records and websocket events
- preserve transcript, summary, action, approval, and cost logging

### 4. Shared data model and ops
- prepare Postgres as the production DB on VPS
- keep Prisma schema compatible for dashboard and agent
- document and script migration from SQLite if needed

### 5. Dashboard updates
- expose telephony provider status for `asterisk`
- surface BYOC setup state instead of Twilio-first assumptions
- show SIP trunk and call-routing health in settings

### 6. Deployment and rollback
- add docker-compose or service definitions for Asterisk and Postgres on VPS
- keep a rollback path to Twilio or Plivo while Asterisk path is stabilized
- add smoke tests for inbound answer, outbound originate, hangup, live transcript, and transfer

## Implementation order
1. Write the spec and store the durable plan.
2. Introduce provider abstraction and Asterisk config in `apps/agent`.
3. Add Asterisk deployment assets and environment contract.
4. Implement Asterisk ARI provider for call lifecycle and outbound originate.
5. Wire audio bridge to the existing agent session pipeline.
6. Add dashboard and settings support for the new provider.
7. Add Postgres deployment and migration support.
8. Validate on VPS end to end with a local or simulated SIP call path.
9. Push PR, merge, deploy.

## Definition of done
- `TELEPHONY_PROVIDER=asterisk` works in the agent runtime.
- Asterisk can accept an inbound call and create a live call record.
- Outbound calls can be originated through Asterisk.
- Call transcript, actions, summary, approvals, and costs still appear in the dashboard.
- Twilio and Plivo still work as legacy providers.
- The single VPS runs the phase 1 stack without adding another country-specific telephony cloud dependency.

## Later phase, not required for phase 1
- Add OpenSIPS or Kamailio in front of Asterisk for multi-tenant SBC needs.
- Add RTPengine if media routing scale or NAT handling needs it.
- Replace managed speech stack only after the telephony layer is stable.
