import { loadLocalEnvironment } from "@/shared/config/load-local-env";

loadLocalEnvironment();

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case "web": {
      const { runNodeScript } = await import("@/cli/process");
      const exitCode = await runNodeScript("scripts/start-standalone.mjs", process.argv.slice(3));
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
    case "preflight": {
      const { preflight } = await import("@/cli/commands/preflight");
      await preflight(process.argv[3] ?? "service");
      console.log(`NextBuf ${process.argv[3] ?? "service"} preflight completed.`);
      return;
    }
    case "version": {
      const { PROJECT } = await import("@/shared/project");
      console.log(PROJECT.version);
      return;
    }
    case "invite": {
      const { invite } = await import("@/cli/commands/invite");
      await invite(process.argv.slice(3));
      return;
    }
    case "mail": {
      const { mail } = await import("@/cli/commands/mail");
      await mail(process.argv.slice(3));
      return;
    }
    default:
      console.log("Usage: nextbuf <web|worker|migrate|setup|doctor|preflight|version|invite|mail>");
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
