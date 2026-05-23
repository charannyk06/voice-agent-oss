# Security Policy

## Supported versions

This project is not yet published as a stable package. Security fixes should target `main`.

## Reporting a vulnerability

Open a private security advisory on GitHub or contact the repository maintainers through the published project contact channel. Do not include secrets, live customer data, call recordings, or full transcripts in a public issue.

## Sensitive data rules

- Never commit `.env` files.
- Never commit SQLite databases, call recordings, transcripts with personal data, or production logs.
- Keep API keys, telephony credentials, Clerk keys, and database passwords in environment variables or a secret manager.
- Rotate any credential that was committed or printed in public logs.

## Hosted deployment requirements

For `DEPLOYMENT_MODE=hosted`, keep these controls enabled:

- `REQUIRE_DASHBOARD_TOKEN=true`
- `REQUIRE_WEBHOOK_SIGNATURES=true`
- `AGENT_DASHBOARD_TOKEN_SECRET` and `AGENT_MEDIA_STREAM_TOKEN_SECRET` set to separate 32-plus character random values
- `DASHBOARD_ALLOWED_ORIGINS` restricted to the hosted dashboard origins
- `INBOUND_ORG_ROUTES` configured for every hosted inbound telephony entry point
- Stripe webhook signature verification enabled with `STRIPE_WEBHOOK_SECRET`
- Usage ingest protected with `BILLING_USAGE_INGEST_SECRET`, `X-Usage-Timestamp`, and `X-Usage-Signature`
- `/health/details` reachable only with a dashboard token that includes `calls:read`

The agent fails startup in hosted mode if dashboard tokens, media stream tokens, webhook signatures, usage ingest, or inbound route mapping are unsafe.

Do not expose secrets through `NEXT_PUBLIC_*` variables. Public variables may include app URLs and publishable browser keys only.

## Deployment warning

Voice agents can process sensitive calls. For production use, review consent, recording, retention, access controls, emergency routing, and compliance requirements for your jurisdiction and industry.
