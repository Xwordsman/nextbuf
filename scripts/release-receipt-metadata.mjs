import { readFile } from "node:fs/promises";

const [receiptPath] = process.argv.slice(2);
if (!receiptPath) {
  throw new Error("Usage: release-receipt-metadata.mjs <receipt-file>");
}

const lines = (await readFile(receiptPath, "utf8")).split(/\r?\n/u);
if (lines.at(-1) === "") lines.pop();
const fields = [
  ["version", /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u],
  ["commit", /^[0-9a-f]{40}$/u],
  ["oci_image", /^ghcr[.]io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/u],
  ["oci_index_digest", /^sha256:[0-9a-f]{64}$/u],
  ["oci_linux_amd64_digest", /^sha256:[0-9a-f]{64}$/u],
  ["oci_linux_arm64_digest", /^sha256:[0-9a-f]{64}$/u],
];
const metadata = {};
for (const [index, [key, pattern]] of fields.entries()) {
  const prefix = `${key}=`;
  const line = lines[index];
  if (!line?.startsWith(prefix)) throw new Error(`Release receipt is missing ${key}`);
  const value = line.slice(prefix.length);
  if (!pattern.test(value)) throw new Error(`Release receipt contains invalid ${key}`);
  metadata[key] = value;
}

process.stdout.write(`${JSON.stringify(metadata)}\n`);
