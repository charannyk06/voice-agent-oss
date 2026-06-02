import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

export function isPostgresDatabaseUrl(value: string | undefined): boolean {
  return Boolean(value?.startsWith('postgresql://') || value?.startsWith('postgres://'));
}

export function resolveSqliteDatabaseUrl(env = process.env): string {
  const explicitSqliteUrl = env.AGENT_SQLITE_DATABASE_URL;
  if (explicitSqliteUrl) return explicitSqliteUrl;

  const configuredUrl = env.DATABASE_URL;
  if (isPostgresDatabaseUrl(configuredUrl)) {
    // The agent Prisma schema is SQLite. Hosted billing can still read Postgres
    // through hosted-billing-database.ts, but runtime call state needs a local
    // SQLite database so the process does not crash or spam errors.
    return 'file:./prisma/prod.db';
  }

  // Point to the same SQLite file as the local web app in self-hosted/dev mode.
  return configuredUrl || 'file:../web/prisma/dev.db';
}

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({ url: resolveSqliteDatabaseUrl() });
  return new PrismaClient({ adapter });
}

// Singleton, one connection shared across MemoryService, ToolService, ApprovalService
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
