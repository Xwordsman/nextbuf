import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import path from "node:path";

if (existsSync(".env.test")) {
  process.loadEnvFile(".env.test");
}

if (process.env.RUN_INTEGRATION_TESTS !== "true") {
  throw new Error(
    "Integration tests require RUN_INTEGRATION_TESTS=true and dedicated PostgreSQL/Redis services.",
  );
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    sequence: {
      concurrent: false,
    },
  },
});
