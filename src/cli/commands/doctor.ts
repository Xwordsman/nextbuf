import { checkRedisHealth } from "@/infrastructure/cache/health";
import { disconnectRedisClient } from "@/infrastructure/cache/redis";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { checkDatabaseHealth } from "@/infrastructure/database/health";
import { getRedisKeyspaces } from "@/infrastructure/cache/keys";
import { getAuthEnvironment, runtimeEnv } from "@/shared/config/runtime-env";
import { getMigrationStatus } from "@/infrastructure/database/migrations";
import { getSystemQueueHealth } from "@/infrastructure/queue/health";
import { verifySmtpConnection } from "@/infrastructure/mail/smtp";
import { verifyObjectStorageConnection } from "@/infrastructure/storage/object-storage";
import { getWorkerHealthStatus } from "@/infrastructure/health/status";
import { getInstallationStatus } from "@/modules/installation/installation.server";
import { getErrorMessage } from "@/shared/errors/error-message";
import { PROJECT } from "@/shared/project";

async function diagnostic(check: () => Promise<unknown>) {
  const startedAt = performance.now();
  try {
    const detail = await check();
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt), detail };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      detail: getErrorMessage(error).slice(0, 500),
    };
  }
}

export async function doctor(): Promise<void> {
  const environment = getAuthEnvironment();
  try {
    const [database, redis, migrations, runtime, installation, queue, worker, mail, storage] =
      await Promise.all([
        checkDatabaseHealth(),
        checkRedisHealth(),
        diagnostic(async () => {
          const status = await getMigrationStatus();
          if (!status.ok) throw new Error("Migration state does not match this release");
          return status;
        }),
        diagnostic(async () => {
          const state = await getPrismaClient().systemState.findUnique({
            where: { key: "runtime.initialized" },
          });
          if (!state) throw new Error("Setup has not initialized the runtime");
          return state;
        }),
        diagnostic(async () => {
          const status = await getInstallationStatus();
          if (!status.complete) throw new Error("First administrator setup is not complete");
          return status;
        }),
        diagnostic(() => getSystemQueueHealth()),
        diagnostic(async () => {
          const status = await getWorkerHealthStatus();
          if (!status.ok) throw new Error("No ready Worker heartbeat was found");
          return status;
        }),
        diagnostic(() => verifySmtpConnection()),
        diagnostic(() => verifyObjectStorageConnection()),
      ]);
    const version = {
      ok: environment.NEXTBUF_VERSION === PROJECT.version,
      configured: environment.NEXTBUF_VERSION,
      application: PROJECT.version,
      commit: environment.NEXTBUF_COMMIT,
      buildTime: environment.NEXTBUF_BUILD_TIME || null,
    };
    const checks = {
      database,
      redis,
      migrations,
      runtime,
      installation,
      queue,
      worker,
      mail,
      storage,
    };
    const ok = version.ok && Object.values(checks).every((check) => check.ok);
    const report = {
      status: ok ? "ok" : "error",
      checkedAt: new Date().toISOString(),
      environment: runtimeEnv.NODE_ENV,
      version,
      keyspaces: getRedisKeyspaces(),
      checks,
    };

    console.log(JSON.stringify(report, null, 2));
    if (!ok) throw new Error("NextBuf doctor found failed checks");
  } finally {
    await disconnectRedisClient();
    await disconnectPrismaClient();
  }
}
