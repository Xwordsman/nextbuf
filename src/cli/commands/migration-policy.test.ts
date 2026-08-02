import { describe, expect, it } from "vitest";
import {
  assertV0_13_10MigrationBaseline,
  assertV1_0_0MigrationPrefix,
  getMigrationDatabaseSchema,
  V0_13_10_BASELINE_MIGRATIONS,
  V1_0_0_MIGRATIONS,
} from "@/cli/commands/migration-policy";

function baselineRows() {
  return V0_13_10_BASELINE_MIGRATIONS.map((migration) => ({ ...migration }));
}

describe("v0.13.10 migration baseline policy", () => {
  it("accepts only the complete immutable migration identity", () => {
    expect(() => assertV0_13_10MigrationBaseline(baselineRows())).not.toThrow();
  });

  it.each([
    ["missing migration", () => baselineRows().slice(1)],
    [
      "changed checksum",
      () =>
        baselineRows().map((row, index) =>
          index === 3 ? { ...row, checksum: "0".repeat(64) } : row,
        ),
    ],
    [
      "unexpected migration",
      () => [
        ...baselineRows(),
        { migrationName: "20260729999999_unexpected", checksum: "f".repeat(64) },
      ],
    ],
  ])("rejects a %s", (_label, rows) => {
    expect(() => assertV0_13_10MigrationBaseline(rows())).toThrow(/immutable v0\.13\.10/);
  });
});

describe("v1.0.0 migration prefix policy", () => {
  it.each([0, 8, 13, V1_0_0_MIGRATIONS.length])(
    "accepts an exact continuous prefix of length %i",
    (length) => {
      expect(() =>
        assertV1_0_0MigrationPrefix(
          V1_0_0_MIGRATIONS.slice(0, length).map((migration) => ({ ...migration })),
        ),
      ).not.toThrow();
    },
  );

  it.each([
    ["missing first migration", () => V1_0_0_MIGRATIONS.slice(1, 4)],
    [
      "changed historical checksum",
      () =>
        V1_0_0_MIGRATIONS.slice(0, 13).map((row, index) =>
          index === 3 ? { ...row, checksum: "0".repeat(64) } : row,
        ),
    ],
    [
      "candidate gap or order change",
      () => [...V1_0_0_MIGRATIONS.slice(0, 13), { ...V1_0_0_MIGRATIONS[14]! }],
    ],
    [
      "unexpected tail",
      () => [
        ...V1_0_0_MIGRATIONS,
        { migrationName: "20260801999999_unexpected", checksum: "f".repeat(64) },
      ],
    ],
  ])("rejects a %s", (_label, rows) => {
    expect(() => assertV1_0_0MigrationPrefix(rows())).toThrow(/exact prefix/);
  });
});

describe("migration database schema", () => {
  it.each([
    ["postgresql://nextbuf:secret@postgres:5432/nextbuf", "public"],
    ["postgresql://nextbuf:secret@postgres:5432/nextbuf?schema=tenant_nextbuf", "tenant_nextbuf"],
  ])("resolves %s", (connectionString, expected) => {
    expect(getMigrationDatabaseSchema(connectionString)).toBe(expected);
  });
});
