import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const standaloneRoot = path.join(root, ".next", "standalone");

async function copyDirectory(source, destination) {
  try {
    await access(source);
  } catch {
    return;
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

await copyDirectory(
  path.join(root, ".next", "static"),
  path.join(standaloneRoot, ".next", "static"),
);
await copyDirectory(path.join(root, "public"), path.join(standaloneRoot, "public"));
