# Contributing

Thanks for improving Voice Agent OSS.

## Local setup

```bash
npm run install:all
cp apps/agent/.env.example apps/agent/.env
cp apps/web/.env.example apps/web/.env
```

## Before opening a PR

Run:

```bash
npm run test
npm run lint
npm run build
```

## Rules

- Do not commit secrets, `.env` files, databases, recordings, transcripts, or customer data.
- Keep provider credentials behind environment variables.
- Keep domain-specific examples generic unless the docs clearly mark them as examples.
- Add tests for tool declarations, runtime filtering, and tool execution when changing agent tools.
- For regulated domains, do not weaken the escalation and no-guessing rules without a clear rationale.
