# Open-source readiness notes

## Current verdict

The current working tree is much closer to open-source ready, but do not make the existing private repository public. Publish through a clean fresh repository or orphan export from the sanitized tree so old commits are not exposed.

The remaining live blockers are operational, not source-code blockers:

1. Wire the real Stripe account and hosted environment secrets outside git.
2. Configure `INBOUND_ORG_ROUTES` for every hosted phone number, SIP route, or provider account.
3. Publish from a clean export, not from the existing repository history.

## Completed hardening in this branch

- Removed app defaults tied to a specific business.
- Renamed the core prompt module from a brand-specific name to `agent-profile.ts`.
- Replaced vertical-specific runtime config with generic business config.
- Removed legacy vertical-specific aliases from public config; use `BUSINESS_*` variables only.
- Replaced domain-specific customer/staff/service concepts with generic customer, staff member, and service concepts.
- Removed private production deploy workflow and local workspace project files.
- Added README, MIT license, contributing guide, security policy, and env examples.
- Added explicit `DEPLOYMENT_MODE=self_hosted|hosted` behavior.
- Added tenant-scoped inbound routing through `INBOUND_ORG_ROUTES`.
- Made hosted inbound calls fail closed when no route maps to an organization.
- Added startup validation so hosted mode requires dashboard tokens, separate media stream tokens, webhook signatures, usage ingest secrets, and at least one inbound route.
- Implemented Plivo V3 webhook signature validation.
- Kept Twilio signature validation required by default in hosted or production mode.
- Split public `/health` from token-protected `/health/details`.
- Protected media stream upgrades with signed stream tokens, optional IP/origin allowlists, and rate limiting.
- Hardened hosted usage ingest with HMAC headers: `X-Usage-Timestamp` and `X-Usage-Signature`.
- Bound usage signatures to raw body, org id, call id, and duration.
- Kept the old bearer usage fallback only outside hosted mode.
- Added PII-safe logging for transcripts, tool calls, phone numbers, approvals, and memory writes.
- Updated dependency overrides and lockfile so npm audit reports no vulnerabilities.
- Replaced credential-shaped example placeholders with non-secret placeholders.
- Added `scripts/create-public-export.sh` to create a tracked-file-only public export after the sanitized tree is committed.
- Added a Prisma RLS migration for Supabase public tables and expanded public export scanning for Supabase, Slack, JWT, private-key, and Twilio token patterns.
- Documented that Supabase deployments must run `prisma migrate deploy` before exposing a project URL, and must re-audit RLS if the Prisma connection role changes.

## Verification run

- `npm test` passed. Agent: 17 files, 70 tests. Web: 23 tests.
- `npm run lint` passed.
- `npm run build` passed for agent and web.
- `npm audit --prefix apps/agent --omit=dev --audit-level=moderate` passed with 0 vulnerabilities.
- `npm audit --prefix apps/web --audit-level=high` passed with 0 vulnerabilities.
- `git diff --check` passed.
- Tracked-file high-confidence secret pattern grep found 0 results after placeholder cleanup.
- Local hosted smoke check passed:
  - `/health` returned `200 {"status":"ok"}`.
  - `/health/details` returned `401` without a dashboard token.

## Stripe status

The Stripe integration code path is in place for hosted billing:

1. Checkout creates subscriptions.
2. Billing portal is available.
3. Stripe webhooks sync customer and subscription state.
4. Hosted call startup checks subscription and quota.
5. Completed calls record `voice_seconds` usage.
6. Optional Stripe Meter Events can report usage to Stripe.
7. The recommended launch plan is documented in `docs/hosted-pricing.md`: $49/month with 60 included hosted voice minutes and a hard cap at launch.

Live Stripe account linkage is not verified in source control. Required secrets must be set in the deployment provider or secret manager, never committed:

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=price_replace_me
STRIPE_METER_EVENT_NAME=voice_seconds
STRIPE_METER_CUSTOMER_KEY=stripe_customer_id
STRIPE_METER_VALUE_KEY=value
```

The agent and dashboard must also share the same `BILLING_USAGE_INGEST_SECRET` value outside git.

## Required hosted environment checklist

For `DEPLOYMENT_MODE=hosted`, configure all of these before live traffic:

```env
REQUIRE_DASHBOARD_TOKEN=true
REQUIRE_WEBHOOK_SIGNATURES=true
AGENT_DASHBOARD_TOKEN_SECRET=
AGENT_MEDIA_STREAM_TOKEN_SECRET=
DASHBOARD_ALLOWED_ORIGINS=https://your-dashboard.example.com
BILLING_USAGE_INGEST_URL=https://your-dashboard.example.com
BILLING_USAGE_INGEST_SECRET=
INBOUND_ORG_ROUTES=twilio:+1555000100=org_abc
```

Hosted route examples:

```env
INBOUND_ORG_ROUTES=twilio:+1555000100=org_abc,plivo:+1555000200=org_def,asterisk:sip.example.com=org_xyz
```

Unknown hosted inbound routes are rejected before call sessions, transcripts, storage, or usage spend begin.

## Public export plan

Recommended publish flow:

1. Commit the sanitized tree on this branch.
2. Create a fresh public repository under the intended owner.
3. Export only tracked files from the sanitized commit:

```bash
./scripts/create-public-export.sh /tmp/voice-agent-public
```

The script refuses dirty working trees and blocks common credential-shaped values, local databases, `.env` files, build output, recordings, transcripts, logs, and `node_modules`.

4. In the fresh repository, run:

```bash
npm run install:all
npm test
npm run lint
npm run build
npm audit --prefix apps/agent --omit=dev --audit-level=moderate
npm audit --prefix apps/web --audit-level=high
git grep -n -E '(sk_(test|live)|rk_(test|live)|whsec_[A-Za-z0-9]|xox[baprs]-|gh[pousr]_|AIza[0-9A-Za-z_-]{10,}|AKIA[0-9A-Z]{16})' || true
```

5. Only then push the fresh repository public.

Do not use Finder copy, zip the whole repo, or run a blind `git add .`. Those paths can pull in `.env`, `.next`, databases, recordings, transcripts, logs, or local workspace files.

## History warning

The current tree is sanitized, but the existing private repo history has old credential-shaped placeholders and private deployment context. Even if those are not live secrets, making the existing repository public would expose that history. Use a fresh public repository or orphan branch export.
