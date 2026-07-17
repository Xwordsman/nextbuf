import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const migrationsRoot = path.join(root, "prisma", "migrations");
const baselinesRoot = path.join(root, "prisma", "migration-baselines");

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

for (const file of baselineFiles) {
  const baseline = JSON.parse(await readFile(path.join(baselinesRoot, file), "utf8"));
  if (!Array.isArray(baseline.migrations) || baseline.migrations.length === 0) {
    throw new Error(`${file} has no migration entries`);
  }
  const expectedPrefix = baseline.migrations.map((migration) => migration.name);
  const actualPrefix = current.slice(0, expectedPrefix.length);
  if (JSON.stringify(actualPrefix) !== JSON.stringify(expectedPrefix)) {
    throw new Error(`${file} migration order no longer matches the repository history`);
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
