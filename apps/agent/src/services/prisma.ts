import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

function createPrismaClient() {
  // Point to the same SQLite file as the web app so both share the full schema
  const dbPath = process.env.DATABASE_URL || 'file:../web/prisma/dev.db';
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

// Singleton, one connection shared across MemoryService, ToolService, ApprovalService
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
