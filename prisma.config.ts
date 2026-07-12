import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url:
      process.env.DATABASE_DIRECT_URL?.trim() ||
      process.env.DATABASE_URL?.trim() ||
      "postgresql://nextbuf:nextbuf@127.0.0.1:5432/nextbuf",
  },
});
