import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL || "postgresql://localhost:5432/voice_agent";

  if (databaseUrl.startsWith("file:")) {
    throw new Error("SQLite DATABASE_URL is no longer supported. Use a Postgres DATABASE_URL for hosted billing and dashboard persistence.");
  }

  const adapter = new PrismaPg(new Pool({
    connectionString: databaseUrl,
    max: 5,
  }));

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
