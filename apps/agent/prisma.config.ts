import { defineConfig } from "prisma/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

function isPostgresUrl(value: string | undefined): boolean {
  return Boolean(value?.startsWith("postgresql://") || value?.startsWith("postgres://"));
}

const configuredUrl = process.env.AGENT_SQLITE_DATABASE_URL || process.env.DATABASE_URL;
const datasourceUrl = configuredUrl && !isPostgresUrl(configuredUrl)
  ? configuredUrl
  : process.env.NODE_ENV === "production"
    ? `file:${path.resolve(configDir, "prisma/prod.db")}`
    : `file:${path.resolve(configDir, "../web/prisma/dev.db")}`;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "migrations",
  },
  datasource: {
    url: datasourceUrl,
  },
});
