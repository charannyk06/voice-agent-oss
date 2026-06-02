# Hosted pricing recommendation

This repo is open source. The paid plan is for the managed hosted service only: hosted dashboard, managed runtime, telephony/model credentials, billing, quota enforcement, support, and uptime. Self-hosters can bring their own credentials and do not pay the hosted subscription.

Pricing checked: 2026-05-21.

## Recommended launch tier

**Shadower Voice Agent Hosted Starter**

- Price: **$49/month**
- Included usage: **60 voice minutes/month**
- Usage enforcement: hard cap at included minutes for launch
- Overage: do not enable at launch. Add top-ups or metered overage after real usage data.
- Hosted env: `HOSTED_MONTHLY_INCLUDED_MINUTES=60`
- Stripe price env: `STRIPE_PRICE_ID=<live monthly price id>`

Why this tier: it is simple to explain, keeps Stripe setup to one recurring price, and leaves enough margin for early users even if calls are mostly outbound.

## Cost model

Current direct provider assumptions:

| Cost item | Source rate | Notes |
| --- | ---: | --- |
| Gemini 3.1 Flash Live audio input | $0.005/min | Google Gemini API pricing |
| Gemini 3.1 Flash Live audio output | $0.018/min | Google Gemini API pricing |
| Twilio US local outbound voice | $0.0140/min | Twilio Programmable Voice US pricing |
| Twilio US local inbound voice | $0.0085/min | Twilio Programmable Voice US pricing |
| Twilio Media Streams | $0.0040/min | Twilio Programmable Voice US pricing |
| Stripe card processing | 2.9% + $0.30 | Stripe pricing |
| Stripe Billing pay-as-you-go | 0.7% of billing volume | Stripe Billing pricing |

Derived direct call cost:

| Call type | Formula | Cost/min |
| --- | --- | ---: |
| Outbound | Gemini in + Gemini out + Twilio outbound + Media Streams | **$0.0410** |
| Inbound | Gemini in + Gemini out + Twilio inbound + Media Streams | **$0.0355** |
| 50/50 blend | average of outbound and inbound | **$0.0383** |

At $49/month with 60 included minutes:

| Scenario | Provider call cost | Stripe fees | Gross profit before server/support |
| --- | ---: | ---: | ---: |
| 60 outbound minutes | $2.46 | $2.06 | $44.48 |
| 60 inbound minutes | $2.13 | $2.06 | $44.81 |
| 60 blended minutes | $2.30 | $2.06 | $44.64 |

Gross margin before server/support is roughly **91%** on the blended case.

## Product behavior

The hosted product should behave like this:

1. User signs in with Clerk.
2. User starts Stripe Checkout for the one monthly plan.
3. Stripe webhook marks the organization `active` after payment succeeds.
4. Agent allows live calls only while the subscription is active and monthly quota is not exhausted. `trialing` usage stays blocked unless `HOSTED_ALLOW_TRIALING_USAGE=true` is explicitly set.
5. Completed calls record `voice_seconds` in the local usage ledger.
6. Dashboard shows subscription status, included minutes, used minutes, and quota percentage.

The current code already supports this model with one recurring `STRIPE_PRICE_ID` and app-side quota enforcement.

## Do not do this at launch

- Do not make all open-source self-hosted usage require payment. That is source-available licensing, not open source.
- Do not commit Stripe keys, webhook secrets, price IDs, account IDs, or customer IDs into the public repo.
- Do not enable automatic overage billing until we have live call-duration data and support workflows.
- Do not make the existing private git history public. Use a fresh public export from the sanitized tree.

## Later upgrade path

After a few real customers:

- Add a $19/100-minute top-up, or
- Add metered overage at **$0.12/min** with Stripe Meter Events.

$0.12/min leaves roughly 65% to 70% gross margin on worst-case outbound minutes before support and infra.
