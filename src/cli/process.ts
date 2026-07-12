import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

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

export async function runNodeScript(
  scriptPath: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const child = spawn(process.execPath, [resolve(process.cwd(), scriptPath), ...args], {
    env: environment,
    stdio: "inherit",
  });

  return await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${scriptPath} exited because of signal ${signal}`));
        return;
      }

      resolveExit(code ?? 1);
    });
  });
}
