import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const [
  directoryArgument,
  tag,
  expectedCommit,
  expectedOciImage,
  expectedOciIndexDigest,
  expectedAmd64Digest,
  expectedArm64Digest,
  releaseBodyPath,
] = process.argv.slice(2);

if (
  !directoryArgument ||
  !tag ||
  !expectedCommit ||
  !expectedOciImage ||
  !expectedOciIndexDigest ||
  !expectedAmd64Digest ||
  !expectedArm64Digest ||
  !releaseBodyPath
) {
  throw new Error(
    "Usage: node scripts/verify-release-receipt.mjs <directory> <v-version> <commit> <oci-image> <index-digest> <amd64-digest> <arm64-digest> <release-body-file>",
  );
}
if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(tag)) {
  throw new Error(`Invalid release tag: ${tag}`);
}
if (!/^[0-9a-f]{40}$/u.test(expectedCommit)) {
  throw new Error("Expected commit must be a full lowercase Git SHA");
}
if (!/^ghcr[.]io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/u.test(expectedOciImage)) {
  throw new Error("Expected OCI image must be an untagged GHCR repository name");
}
for (const digest of [expectedOciIndexDigest, expectedAmd64Digest, expectedArm64Digest]) {
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    throw new Error("Expected OCI identities must be full SHA-256 digests");
  }
}

const directory = path.resolve(directoryArgument);
const version = tag.slice(1);
const archiveName = `nextbuf-${version}-linux-x64.tar.gz`;
const checksumName = `${archiveName}.sha256`;
const sbomName = `nextbuf-${tag}-sbom.spdx.json`;
const receiptName = `nextbuf-${tag}-release-complete.txt`;
const expectedAssets = [archiveName, checksumName, sbomName].sort();

const receipt = await readFile(path.join(directory, receiptName), "utf8");
const receiptLines = receipt.split(/\r?\n/u);
if (receiptLines.at(-1) === "") receiptLines.pop();
if (receiptLines.length !== expectedAssets.length + 7) {
  throw new Error("Release completion receipt has an unexpected number of lines");
}
if (receiptLines[0] !== `version=${version}`) {
  throw new Error("Release completion receipt version does not match the tag");
}
if (receiptLines[1] !== `commit=${expectedCommit}`) {
  throw new Error("Release completion receipt commit does not match the tag target");
}
if (receiptLines[2] !== `oci_image=${expectedOciImage}`) {
  throw new Error("Release completion receipt OCI image does not match");
}
if (receiptLines[3] !== `oci_index_digest=${expectedOciIndexDigest}`) {
  throw new Error("Release completion receipt OCI index digest does not match");
}
if (receiptLines[4] !== `oci_linux_amd64_digest=${expectedAmd64Digest}`) {
  throw new Error("Release completion receipt amd64 digest does not match");
}
if (receiptLines[5] !== `oci_linux_arm64_digest=${expectedArm64Digest}`) {
  throw new Error("Release completion receipt arm64 digest does not match");
}

const releaseBody = await readFile(path.resolve(releaseBodyPath));
const releaseBodySha256 = createHash("sha256").update(releaseBody).digest("hex");
if (receiptLines[6] !== `release_body_sha256=${releaseBodySha256}`) {
  throw new Error("Release body SHA-256 does not match the completion receipt");
}

const recordedDigests = new Map();
for (const line of receiptLines.slice(7)) {
  const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
  if (!match) throw new Error("Release completion receipt contains an invalid SHA-256 line");

  const [, digest, fileName] = match;
  if (!expectedAssets.includes(fileName) || recordedDigests.has(fileName)) {
    throw new Error(`Release completion receipt contains an unexpected asset: ${fileName}`);
  }
  recordedDigests.set(fileName, digest);
}

if (recordedDigests.size !== expectedAssets.length) {
  throw new Error("Release completion receipt does not cover every required asset");
}

const actualDigests = new Map();
for (const fileName of expectedAssets) {
  const contents = await readFile(path.join(directory, fileName));
  const digest = createHash("sha256").update(contents).digest("hex");
  actualDigests.set(fileName, digest);
  if (recordedDigests.get(fileName) !== digest) {
    throw new Error(`Release asset SHA-256 does not match the receipt: ${fileName}`);
  }
}

const checksum = (await readFile(path.join(directory, checksumName), "utf8")).trimEnd();
if (checksum !== `${actualDigests.get(archiveName)}  ${archiveName}`) {
  throw new Error("Release archive checksum asset does not match the archive");
}

console.log(`Verified release completion receipt for ${tag} at ${expectedCommit}`);
