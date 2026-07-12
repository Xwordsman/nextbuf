import { loadLocalEnvironment } from "@/shared/config/load-local-env";

loadLocalEnvironment();

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case "web": {
      const { runNodePackageBinary } = await import("@/cli/process");
      const exitCode = await runNodePackageBinary("next/dist/bin/next", [
        "start",
        ...process.argv.slice(3),
      ]);
      process.exitCode = exitCode;
      return;
    }
    case "worker": {
      const { startWorker } = await import("@/worker/runtime");
      await startWorker();
      return;
    }
    case "migrate": {
      const { migrate } = await import("@/cli/commands/migrate");
      await migrate();
      return;
    }
    case "setup": {
      const { setup } = await import("@/cli/commands/setup");
      await setup();
      console.log("NextBuf setup completed.");
      return;
    }
    case "doctor": {
      const { doctor } = await import("@/cli/commands/doctor");
      await doctor();
      return;
    }
    default:
      console.log("Usage: nextbuf <web|worker|migrate|setup|doctor>");
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
