import { loadLocalEnvironment } from "@/shared/config/load-local-env";

loadLocalEnvironment();

const { startWorker } = await import("@/worker/runtime");

startWorker().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
