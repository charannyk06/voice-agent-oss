# Voice Agent OSS

Open-source voice agent starter for inbound and outbound phone calls. It combines a Node.js voice runtime, Gemini Live function calling, telephony adapters, Stripe billing for hosted usage, and a Next.js operations dashboard.

## Hosted dashboard

For managed deployments, put the live dashboard URL in the GitHub repository homepage or release notes, not in committed source. Self-hosters should set `NEXT_PUBLIC_APP_URL` or `PUBLIC_APP_URL` to their own dashboard origin.

## What it includes

- Live voice runtime with Gemini Live
- Telephony adapters for Twilio, Plivo, and Asterisk BYOC
- Dashboard for calls, contacts, appointments, costs, approvals, tools, billing, and agent configuration
- Clerk authentication for the dashboard
- Stripe Checkout, Billing Portal, subscription webhooks, usage ledger, and optional Stripe Meter Events
- Hosted-mode billing gates before live calls start
- Signed dashboard and media stream tokens for runtime control surfaces
- Prisma data model with SQLite for local development
- Optional external knowledge search via a generic connector
- Configurable business profile, greeting, safety rules, tools, and knowledge docs

## Open source vs hosted billing

Self-hosters can run the code with their own model, telephony, database, and Stripe accounts. Paid usage applies to the managed hosted service, where the hosted infrastructure pays for model calls, telephony, uptime, and dashboard operations.

Set `DEPLOYMENT_MODE=self_hosted` for local or customer-owned deployments. Set `DEPLOYMENT_MODE=hosted` only when Clerk, Stripe, dashboard tokens, media stream tokens, provider webhook signatures, and usage ingest secrets are configured.

## Repository layout

```text
apps/agent/        Node.js voice runtime, telephony webhooks, Gemini Live bridge
apps/web/          Next.js dashboard, Clerk auth, Stripe billing, Prisma models
ops/vps-phase1/    Example VPS deployment assets for Asterisk and Postgres
scripts/           Shared run helpers
```

## Quick start

```bash
npm run install:all
cp apps/agent/.env.example apps/agent/.env
cp apps/web/.env.example apps/web/.env
npm run build
npm run dev
```

Then open the web dashboard on `http://localhost:3011`. The public agent health endpoint is `http://localhost:3012/health` and only returns minimal status.

## Required configuration

At minimum, set these values in `apps/agent/.env`:

```env
GEMINI_API_KEY=
BUSINESS_NAME=Example Business
BUSINESS_RECEPTION_NUMBER=+15555550100
TELEPHONY_PROVIDER=twilio
```

For the dashboard, configure Clerk in `apps/web/.env`:

```env
DATABASE_URL=replace_with_postgres_database_url
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=replace_with_clerk_publishable_key
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
```

The dashboard uses Postgres through Prisma. SQLite is intentionally not supported for hosted billing because Vercel serverless functions do not provide persistent local disk.

### Apply database migrations (required, especially on Supabase)

```bash
cd apps/web && npx prisma migrate deploy
```

The migration set under `apps/web/prisma/migrations/` includes `20260527014444_enable_rls_with_org_policies/migration.sql`, which enables Row-Level Security on every public-schema table and adds tenant-scoped policies for the Supabase `authenticated` role. **Skip this and your Supabase project will fail the `rls_disabled_in_public` linter and expose every table to anyone with your anon key.** The migration is idempotent and safe to re-run.

The migration assumes the app connects via the `postgres` role (which has `rolbypassrls=true`), the default Prisma + Supabase setup. If you change the connection role, re-audit the policies in that file. Read the file's top-of-file comment block before deploying — it explains the Clerk-to-Supabase JWT bridging assumption.

Do not commit `.env` files. Only commit `.env.example` files with placeholders.

## Payments and hosted usage

The recommended launch offer is one hosted tier: **$49/month with 60 included voice minutes**. See `docs/hosted-pricing.md` for the cost model and margin math.

Hosted billing uses Stripe in four layers:

1. Checkout creates the subscription for the current Clerk user or organization.
2. Stripe webhooks sync customer, subscription status, period dates, and included minutes.
3. The agent checks subscription and quota before starting live hosted calls.
4. Completed calls are recorded as `voice_seconds`; optional Stripe Meter Events can bill overage or pure usage-based plans.

Required hosted billing variables in `apps/web/.env`:

```env
DEPLOYMENT_MODE=hosted
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=price_value
HOSTED_MONTHLY_INCLUDED_MINUTES=60
BILLING_USAGE_INGEST_SECRET=
```

Optional Stripe meter variables:

```env
STRIPE_METER_EVENT_NAME=voice_seconds
STRIPE_METER_CUSTOMER_KEY=stripe_customer_id
STRIPE_METER_VALUE_KEY=value
```

Required hosted billing variables in `apps/agent/.env`:

```env
DEPLOYMENT_MODE=hosted
BILLING_USAGE_INGEST_URL=https://your-dashboard.example.com
BILLING_USAGE_INGEST_SECRET=
INBOUND_ORG_ROUTES=twilio:+15555550100=org_abc
```

Hosted usage ingest uses `X-Usage-Timestamp` and `X-Usage-Signature`; the signature is an HMAC-SHA256 over the raw JSON body plus `orgId`, `callId`, and `durationSeconds`. The old shared bearer fallback is only accepted outside `DEPLOYMENT_MODE=hosted`.

## Telephony modes

### Twilio

Set `TELEPHONY_PROVIDER=twilio`, configure Twilio credentials, and point your number webhook to `/webhook/twilio`.

### Plivo

Set `TELEPHONY_PROVIDER=plivo`, configure Plivo credentials, and point your answer webhook to `/webhook/plivo/answer`. In hosted or production-like mode, Plivo webhooks must include `X-Plivo-Signature-V3` and `X-Plivo-Signature-V3-Nonce`.

### Asterisk BYOC

Set `TELEPHONY_PROVIDER=asterisk`. See `ops/vps-phase1/README.md` for the example Asterisk plus Postgres deployment.

### Hosted inbound routing

Hosted inbound calls must map to an organization before billing, sessions, transcripts, or storage happen. Configure exact route entries:

```env
INBOUND_ORG_ROUTES=twilio:+15551234567=org_abc,plivo:+9199=org_def,asterisk:sip.example.com=org_xyz
```

Self-hosted mode keeps `AGENT_DEFAULT_ORG_ID` fallback behavior. Hosted mode rejects unknown inbound routes. Outbound status callbacks use the active session organization when the provider call id matches.

Optional media stream upgrade allowlists can be set with `TELEPHONY_STREAM_ALLOWED_IPS` and `TELEPHONY_STREAM_ALLOWED_ORIGINS`. Leave them empty for normal Twilio/Plivo compatibility.

## Security defaults

- Dashboard REST and WebSocket control surfaces require signed dashboard tokens when hosted.
- Telephony media streams use signed short-lived stream tokens.
- Provider webhook signatures are required by default in production or hosted mode.
- `/health` returns minimal non-sensitive JSON; `/health/details` requires a dashboard token with `calls:read`.
- Dashboard API routes enforce auth at the route-handler layer, not only middleware.
- Cross-site mutation requests are blocked by middleware unless the origin is allowed.
- Hosted startup fails closed if dashboard tokens, media stream tokens, webhook signatures, usage ingest settings, or inbound org routes are unsafe.
- Stripe webhooks require signature verification and idempotent event processing.
- Public browser env vars must be limited to non-secret `NEXT_PUBLIC_*` values such as app URLs and Clerk publishable keys.

The default prompt is intentionally conservative. It tells the agent to avoid regulated professional advice, avoid guessing, and escalate high-risk questions to a human. If you adapt this for healthcare, legal, finance, insurance, or other regulated use, add domain-specific review, logging, consent, and compliance controls before production.

## Development checks

```bash
npm run test
npm run lint
npm run build
npm audit --prefix apps/agent --omit=dev --audit-level=moderate
npm audit --prefix apps/web --audit-level=high
```

## Open-source hygiene

Before publishing a fork or public repo:

1. Run a secret scan.
2. Confirm `.env`, `.db`, `.vercel`, recordings, transcripts, logs, and local workspace files are ignored.
3. Remove production deploy workflows that target private infrastructure.
4. Replace example business content with your own placeholders.
5. Rebuild Prisma clients after schema changes.
6. Prefer a fresh public repo or orphan branch if private history ever contained secrets, customer data, or internal hostnames.
7. Use `./scripts/create-public-export.sh /tmp/voice-agent-public` to export a tracked-file-only public tree after committing.

## License

MIT. See `LICENSE`.
