import { defineConfig } from "prisma/config";
import path from "path";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrate: {
    migrations: "migrations",
  },
  datasource: {
    url: `file:${path.resolve(__dirname, "../web/prisma/dev.db")}`,
  },
});
