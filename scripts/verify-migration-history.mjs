import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const migrationsRoot = path.join(root, "prisma", "migrations");
const baselinesRoot = path.join(root, "prisma", "migration-baselines");
const packageMetadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const current = (await readdir(migrationsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d+_[a-z0-9_]+$/i.test(entry.name))
  .map((entry) => entry.name)
  .sort();
const baselineFiles = (await readdir(baselinesRoot))
  .filter((name) => /^v\d+\.\d+\.\d+\.json$/u.test(name))
  .sort();

if (baselineFiles.length === 0) throw new Error("No migration baseline manifests were found");
const currentBaselineFile = `v${packageMetadata.version}.json`;
if (!baselineFiles.includes(currentBaselineFile)) {
  throw new Error(
    `${currentBaselineFile} is required for package version ${packageMetadata.version}`,
  );
}

for (const file of baselineFiles) {
  const baseline = JSON.parse(await readFile(path.join(baselinesRoot, file), "utf8"));
  const filenameVersion = file.slice(1, -".json".length);
  if (baseline.version !== filenameVersion) {
    throw new Error(`${file} declares version ${String(baseline.version)}`);
  }
  if (!Array.isArray(baseline.migrations) || baseline.migrations.length === 0) {
    throw new Error(`${file} has no migration entries`);
  }
  const expectedPrefix = baseline.migrations.map((migration) => migration.name);
  const actualPrefix = current.slice(0, expectedPrefix.length);
  if (JSON.stringify(actualPrefix) !== JSON.stringify(expectedPrefix)) {
    throw new Error(`${file} migration order no longer matches the repository history`);
  }
  if (file === currentBaselineFile && expectedPrefix.length !== current.length) {
    throw new Error(`${file} must cover all ${current.length} current migrations`);
  }

  for (const migration of baseline.migrations) {
    const sql = await readFile(path.join(migrationsRoot, migration.name, "migration.sql"));
    const actual = digest(sql);
    if (actual !== migration.sha256) {
      throw new Error(
        `${migration.name} changed after ${baseline.version}: expected ${migration.sha256}, received ${actual}`,
      );
    }
  }

  console.log(`Verified ${baseline.version}: ${baseline.migrations.length} immutable migrations`);
}
