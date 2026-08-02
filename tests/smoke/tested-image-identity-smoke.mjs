import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts", "tested-image-identity.mjs");
const directory = await mkdtemp(path.join(tmpdir(), "nextbuf-tested-image-"));
const image = "ghcr.io/xwordsman/nextbuf";
const commit = "a".repeat(40);
const version = "1.0.0";
const amd64 = `sha256:${"b".repeat(64)}`;
const arm64 = `sha256:${"c".repeat(64)}`;
const amd64Source = `sha256:${"d".repeat(64)}`;
const arm64Source = `sha256:${"e".repeat(64)}`;

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  if (result.status !== expectedStatus) {
    throw new Error(`Unexpected identity command status: ${result.stderr || result.stdout}`);
  }
  return result;
}

try {
  run([
    "write",
    path.join(directory, "amd64.json"),
    image,
    "linux/amd64",
    amd64,
    amd64Source,
    commit,
    version,
  ]);
  run([
    "write",
    path.join(directory, "arm64.json"),
    image,
    "linux/arm64",
    arm64,
    arm64Source,
    commit,
    version,
  ]);
  const verified = run(["verify", directory, image, commit, version]);
  if (
    verified.stdout !==
    `linux/amd64.runtime=${amd64}\n` +
      `linux/amd64.source=${amd64Source}\n` +
      `linux/arm64.runtime=${arm64}\n` +
      `linux/arm64.source=${arm64Source}\n`
  ) {
    throw new Error("Verified tested image members were not deterministic");
  }

  const arm64File = path.join(directory, "arm64.json");
  const changed = JSON.parse(await readFile(arm64File, "utf8"));
  changed.commit = "d".repeat(40);
  await writeFile(arm64File, `${JSON.stringify(changed)}\n`);
  const rejected = run(["verify", directory, image, commit, version], 1);
  if (!rejected.stderr.includes("does not match")) {
    throw new Error("Changed tested image identity did not produce the expected rejection");
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
