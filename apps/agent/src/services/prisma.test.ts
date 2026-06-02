import { describe, expect, it } from 'vitest';
import { isPostgresDatabaseUrl, resolveSqliteDatabaseUrl } from './prisma';

describe('agent prisma database url resolution', () => {
  it('keeps sqlite URLs for local/self-hosted agent state', () => {
    expect(resolveSqliteDatabaseUrl({ DATABASE_URL: 'file:../web/prisma/dev.db' } as NodeJS.ProcessEnv)).toBe('file:../web/prisma/dev.db');
  });

  it('uses a local sqlite runtime store when hosted billing uses Postgres', () => {
    expect(resolveSqliteDatabaseUrl({ DATABASE_URL: 'postgresql://localhost:5432/voice_agent' } as NodeJS.ProcessEnv)).toBe('file:./prisma/prod.db');
    expect(isPostgresDatabaseUrl('postgres://localhost:5432/voice_agent')).toBe(true);
  });

  it('lets operators override the local sqlite runtime store explicitly', () => {
    expect(resolveSqliteDatabaseUrl({
      DATABASE_URL: 'postgresql://localhost:5432/voice_agent',
      AGENT_SQLITE_DATABASE_URL: 'file:/var/lib/voice-agent/runtime.db',
    } as NodeJS.ProcessEnv)).toBe('file:/var/lib/voice-agent/runtime.db');
  });
});
