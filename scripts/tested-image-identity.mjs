import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const imagePattern = /^ghcr[.]io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/u;
const platforms = ["linux/amd64", "linux/arm64"];

function validateIdentity(identity, expected = {}) {
  if (
    identity?.schemaVersion !== 2 ||
    !imagePattern.test(identity.image) ||
    !platforms.includes(identity.platform) ||
    !digestPattern.test(identity.runtimeDigest) ||
    !digestPattern.test(identity.sourceDigest) ||
    !commitPattern.test(identity.commit) ||
    typeof identity.version !== "string" ||
    identity.version.length === 0
  ) {
    throw new Error("Invalid tested OCI image identity");
  }
  for (const [key, value] of Object.entries(expected)) {
    if (identity[key] !== value) {
      throw new Error(`Tested OCI image ${key} does not match the workflow candidate`);
    }
  }
}

async function writeIdentity(args) {
  const [file, image, platform, runtimeDigest, sourceDigest, commit, version] = args;
  if (!file || !image || !platform || !runtimeDigest || !sourceDigest || !commit || !version) {
    throw new Error(
      "Usage: tested-image-identity.mjs write <file> <image> <platform> <runtime-digest> <source-digest> <commit> <version>",
    );
  }
  const identity = {
    schemaVersion: 2,
    image,
    platform,
    runtimeDigest,
    sourceDigest,
    commit,
    version,
  };
  validateIdentity(identity);
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(path.resolve(file), `${JSON.stringify(identity)}\n`, { flag: "wx" });
}

async function verifyIdentities(args) {
  const [directory, image, commit, version] = args;
  if (!directory || !image || !commit || !version) {
    throw new Error(
      "Usage: tested-image-identity.mjs verify <directory> <image> <commit> <version>",
    );
  }
  const root = path.resolve(directory);
  const files = (await readdir(root)).filter((file) => file.endsWith(".json")).sort();
  if (files.length !== platforms.length) {
    throw new Error("Expected exactly one tested OCI identity for each supported platform");
  }

  const identities = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"))),
  );
  for (const identity of identities) validateIdentity(identity, { image, commit, version });
  const byPlatform = new Map(identities.map((identity) => [identity.platform, identity]));
  if (
    byPlatform.size !== platforms.length ||
    platforms.some((platform) => !byPlatform.has(platform))
  ) {
    throw new Error("Tested OCI identities do not cover the exact supported platform set");
  }
  process.stdout.write(
    `${platforms
      .flatMap((platform) => {
        const identity = byPlatform.get(platform);
        return [
          `${platform}.runtime=${identity.runtimeDigest}`,
          `${platform}.source=${identity.sourceDigest}`,
        ];
      })
      .join("\n")}\n`,
  );
}

const [command, ...args] = process.argv.slice(2);
if (command === "write") await writeIdentity(args);
else if (command === "verify") await verifyIdentities(args);
else throw new Error("Usage: tested-image-identity.mjs <write|verify> ...");
