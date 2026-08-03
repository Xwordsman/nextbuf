import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_INTEGRITY_NAMES,
  ACCEPTANCE_OPERATION_NAMES,
  ACCEPTANCE_SNAPSHOT_FORMAT,
  ACCEPTANCE_STABLE_GROUP_NAMES,
  ACCEPTANCE_STABLE_TABLE_NAMES,
  compareAcceptanceSnapshots,
  parseAcceptanceSnapshot,
  type AcceptanceFingerprint,
  type AcceptanceIntegrityCheck,
  type AcceptanceSnapshot,
} from "@/cli/acceptance-contract";

const digest = (character: string) => `hmac-sha256:${character.repeat(64)}`;

function fingerprints(
  names: readonly string[],
  character: string,
): Record<string, AcceptanceFingerprint> {
  return Object.fromEntries(names.map((name) => [name, { rows: 0, digest: digest(character) }]));
}

function integrity(phase: "before" | "after"): Record<string, AcceptanceIntegrityCheck> {
  return Object.fromEntries(
    ACCEPTANCE_INTEGRITY_NAMES.map((name) => [
      name,
      {
        applicable:
          ![
            "deleted_user_auth_quarantine",
            "outbox_processed_linkage",
            "email_attempt_fencing_state",
            "worker_mail_failure_linkage",
          ].includes(name) || phase === "after",
        ok: true,
        violations: 0,
      },
    ]),
  );
}

function operations(phase: "before" | "after"): Record<string, number> {
  return Object.fromEntries(
    ACCEPTANCE_OPERATION_NAMES.map((name) => [
      name,
      name === "worker.heartbeats" && phase === "before" ? 1 : 0,
    ]),
  );
}

const contractRecords = [
  ["snapshot.capabilities", (value: AcceptanceSnapshot) => value.capabilities],
  ["snapshot.stable.tables", (value: AcceptanceSnapshot) => value.stable.tables],
  ["snapshot.stable.groups", (value: AcceptanceSnapshot) => value.stable.groups],
  ["snapshot.integrity", (value: AcceptanceSnapshot) => value.integrity],
  ["snapshot.operations", (value: AcceptanceSnapshot) => value.operations],
] as const;

function snapshot(phase: "before" | "after"): AcceptanceSnapshot {
  const migrations = [
    { migrationName: "20260101000000_initial", checksum: "1".repeat(64) },
    { migrationName: "20260102000000_candidate", checksum: "2".repeat(64) },
  ];
  return {
    format: ACCEPTANCE_SNAPSHOT_FORMAT,
    capturedAt: phase === "before" ? "2026-08-03T00:00:00.000Z" : "2026-08-03T00:01:00.000Z",
    application: {
      version: "1.0.0",
      configuredVersion: phase === "before" ? "0.13.10" : "1.0.0",
      commit: "a".repeat(40),
      buildTime: "2026-08-03T00:00:00.000Z",
    },
    database: {
      schemaNameFingerprint: digest("a"),
      transactionReadOnly: true,
      expectedMigrations: migrations,
      appliedMigrations: phase === "before" ? migrations.slice(0, 1) : migrations,
      failedMigrations: [],
    },
    privacy: {
      algorithm: "HMAC-SHA-256",
      keyId: digest("b"),
      rawIdentifiersIncluded: false,
      secretsIncluded: false,
    },
    capabilities: {
      accountDeletionFinalization: phase === "after",
      outboxProcessedStatus: phase === "after",
      emailAttemptFencing: phase === "after",
    },
    stable: {
      tables: {
        ...fingerprints(ACCEPTANCE_STABLE_TABLE_NAMES, "c"),
        users_active: { rows: 2, digest: digest("c") },
        community_posts: { rows: 3, digest: digest("d") },
      },
      groups: fingerprints(ACCEPTANCE_STABLE_GROUP_NAMES, "e"),
      overall: { rows: 5, digest: digest("0") },
    },
    integrity: integrity(phase),
    administratorContinuity: {
      eligibleAdministrators: 2,
      state: "healthy",
    },
    storage: {
      requested: true,
      ok: true,
      originals: 1,
      processedObjects: 1,
      missingOriginals: 0,
      checksumMismatches: 0,
      missingProcessedObjects: 0,
      fingerprint: digest("9"),
    },
    operations: { ...operations(phase), "users.total": 2 },
  };
}

describe("acceptance snapshot contract", () => {
  it("accepts a privacy-safe stopped-service upgrade comparison", () => {
    const comparison = compareAcceptanceSnapshots(
      snapshot("before"),
      snapshot("after"),
      "2026-08-03T00:02:00.000Z",
    );

    expect(comparison).toMatchObject({
      status: "pass",
      sourceVersion: "0.13.10",
      targetVersion: "1.0.0",
      issues: [],
      warnings: [],
    });
  });

  it("identifies the table whose stable facts changed", () => {
    const before = snapshot("before");
    const after = snapshot("after");
    after.stable.tables.community_posts = { rows: 2, digest: digest("8") };
    after.stable.overall = { rows: 4, digest: digest("7") };

    const comparison = compareAcceptanceSnapshots(before, after);

    expect(comparison.status).toBe("fail");
    expect(comparison.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "stable_data_changed", subject: "community_posts" }),
        expect.objectContaining({ code: "stable_aggregate_changed" }),
      ]),
    );
  });

  it("keeps one administrator as a visible release warning", () => {
    const before = snapshot("before");
    const after = snapshot("after");
    before.administratorContinuity = {
      eligibleAdministrators: 1,
      state: "redundancy_warning",
    };
    after.administratorContinuity = {
      eligibleAdministrators: 1,
      state: "redundancy_warning",
    };

    const comparison = compareAcceptanceSnapshots(before, after);

    expect(comparison.status).toBe("pass");
    expect(comparison.warnings).toEqual([
      { code: "administrator_redundancy_missing", subject: "administratorContinuity" },
    ]);
  });

  it("rejects snapshots that claim to contain raw identifiers", () => {
    const unsafe = structuredClone(snapshot("after")) as unknown as Record<string, unknown>;
    (unsafe.privacy as Record<string, unknown>).rawIdentifiersIncluded = true;

    expect(() => parseAcceptanceSnapshot(unsafe)).toThrow(
      "must not contain raw identifiers or secrets",
    );
  });

  for (const [path, select] of contractRecords) {
    it(`rejects an empty ${path} contract shell`, () => {
      const empty = structuredClone(snapshot("after"));
      const record = select(empty) as Record<string, unknown>;
      for (const key of Object.keys(record)) delete record[key];

      expect(() => parseAcceptanceSnapshot(empty)).toThrow(`${path} is missing required field(s)`);
    });

    it(`rejects missing and extra ${path} contract items`, () => {
      const missing = structuredClone(snapshot("after"));
      const missingRecord = select(missing) as Record<string, unknown>;
      const required = Object.keys(missingRecord)[0]!;
      delete missingRecord[required];
      expect(() => parseAcceptanceSnapshot(missing)).toThrow(
        `${path} is missing required field(s): ${required}`,
      );

      const extra = structuredClone(snapshot("after"));
      const extraRecord = select(extra) as Record<string, unknown>;
      extraRecord.unexpectedEvidence = 1;
      expect(() => parseAcceptanceSnapshot(extra)).toThrow(
        `${path} has unknown field(s): unexpectedEvidence`,
      );
    });
  }

  it("recursively rejects unknown evidence fields", () => {
    const root = structuredClone(snapshot("after")) as unknown as Record<string, unknown>;
    root.email = "member@example.test";
    expect(() => parseAcceptanceSnapshot(root)).toThrow("snapshot has unknown field(s): email");

    const unsafe = structuredClone(snapshot("after")) as unknown as Record<string, unknown>;
    (unsafe.application as Record<string, unknown>).sessionToken = "sensitive-session-token";
    expect(() => parseAcceptanceSnapshot(unsafe)).toThrow(
      "snapshot.application has unknown field(s): sessionToken",
    );

    const nested = structuredClone(snapshot("after")) as unknown as Record<string, unknown>;
    ((nested.stable as Record<string, unknown>).tables as Record<string, unknown>).users_active = {
      rows: 2,
      digest: digest("c"),
      email: "member@example.test",
    };
    expect(() => parseAcceptanceSnapshot(nested)).toThrow(
      "snapshot.stable.tables.users_active has unknown field(s): email",
    );
  });
});
