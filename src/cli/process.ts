import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export async function runNodePackageBinary(
  packageName: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const entry = require.resolve(packageName);
  const child = spawn(process.execPath, [entry, ...args], {
    env: environment,
    stdio: "inherit",
  });

  return await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${packageName} exited because of signal ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  });
}
