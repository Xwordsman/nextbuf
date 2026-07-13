import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const launchDirectory = process.cwd();
const environmentFile = path.join(launchDirectory, ".env");

if (existsSync(environmentFile)) {
  process.loadEnvFile(environmentFile);
}

const storagePath = process.env.STORAGE_LOCAL_PATH?.trim() || "data/uploads";
if (!path.isAbsolute(storagePath)) {
  process.env.STORAGE_LOCAL_PATH = path.resolve(launchDirectory, storagePath);
}

await import(pathToFileURL(path.join(launchDirectory, ".next", "standalone", "server.js")).href);
