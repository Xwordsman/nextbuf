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

// Keep production defaults intact while making Redis-loss and lease-renewal coverage fast.
process.env.OUTBOX_RECOVERY_AFTER_MS = "1000";
process.env.OUTBOX_LOCK_TIMEOUT_MS = "1000";
process.env.WORKER_TASK_LOCK_TIMEOUT_MS = "5000";
if (!process.env.TOPIC_VIEW_PREVIOUS_AUTH_SECRETS?.trim()) {
  process.env.TOPIC_VIEW_PREVIOUS_AUTH_SECRETS = JSON.stringify([
    "nextbuf-integration-previous-auth-secret-one-at-least-32-characters",
    "nextbuf-integration-previous-auth-secret-two-at-least-32-characters",
  ]);
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/support/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    sequence: {
      concurrent: false,
    },
  },
});
