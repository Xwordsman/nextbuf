import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnvironment(): void {
  const environmentFile = resolve(process.cwd(), ".env");

  if (existsSync(environmentFile)) {
    process.loadEnvFile(environmentFile);
  }
}
