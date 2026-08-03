export const ACCEPTANCE_SNAPSHOT_FORMAT = "nextbuf-acceptance-snapshot-v1" as const;
export const ACCEPTANCE_COMPARISON_FORMAT = "nextbuf-acceptance-comparison-v1" as const;

const digestPattern = /^hmac-sha256:[a-f0-9]{64}$/;
const checksumPattern = /^[a-f0-9]{64}$/;

export const ACCEPTANCE_CAPABILITY_NAMES = [
  "accountDeletionFinalization",
  "outboxProcessedStatus",
  "emailAttemptFencing",
] as const;

export const ACCEPTANCE_STABLE_TABLE_NAMES = [
  "users_active",
  "users_deleted_anchors",
  "profiles",
  "username_aliases_active",
  "auth_accounts_active",
  "auth_sessions_active",
  "auth_verifications_non_deleted",
  "registration_invites",
  "admin_reauthentications_active",
  "community_nodes",
  "community_topics",
  "community_posts",
  "community_post_revisions",
  "community_post_drafts",
  "community_reply_editor_sessions",
  "community_post_mentions",
  "community_attachments",
  "community_post_attachments",
  "community_revision_attachments",
  "community_post_draft_attachments",
  "community_audit_events",
  "interaction_post_likes",
  "interaction_topic_bookmarks",
  "interaction_user_follows",
  "interaction_topic_follows",
  "interaction_topic_read_states",
  "interaction_topic_views",
  "community_role_assignments",
  "moderation_cases",
  "moderation_reports",
  "moderation_actions",
  "moderation_sanctions",
  "governance_audit_events",
  "trust_rule_versions",
  "trust_user_states",
  "trust_level_history",
  "trust_recalculation_batches",
  "notifications",
  "notification_preferences",
  "notification_deliveries_structure",
  "site_settings",
  "identity_audit_events",
  "system_state_static",
  "email_deliveries_preserved",
  "outbox_events_structure",
  "processed_jobs",
  "worker_job_failures_structure",
  "worker_scheduled_tasks",
] as const;

export const ACCEPTANCE_STABLE_GROUP_NAMES = [
  "identity",
  "authentication",
  "community",
  "interactions",
  "governance",
  "messaging",
  "operations_preserved",
] as const;

export const ACCEPTANCE_INTEGRITY_NAMES = [
  "topic_exactly_one_first_post",
  "topic_next_post_position",
  "topic_reply_count",
  "post_revision_count_and_sequence",
  "post_like_count",
  "topic_bookmark_count",
  "account_deletion_request_pair",
  "valid_ready_indexes",
  "validated_constraints",
  "deleted_user_auth_quarantine",
  "outbox_processed_linkage",
  "email_attempt_fencing_state",
  "worker_mail_failure_linkage",
] as const;

export const ACCEPTANCE_OPERATION_NAMES = [
  "users.total",
  "users.active",
  "users.pending",
  "users.deleted",
  "auth.credentials",
  "auth.sessions",
  "community.topics",
  "community.posts",
  "community.attachments",
  "outbox.unpublished",
  "worker.failures_unresolved",
  "mail.pending_or_sending",
  "mail.failed_or_unknown",
  "worker.scheduled_tasks",
  "worker.heartbeats",
] as const;

export type AcceptanceMigrationIdentity = {
  migrationName: string;
  checksum: string;
};

export type AcceptanceFingerprint = {
  rows: number;
  digest: string;
};

export type AcceptanceIntegrityCheck = {
  applicable: boolean;
  ok: boolean;
  violations: number;
};

export type AcceptanceStorageVerification = {
  requested: boolean;
  ok: boolean | null;
  originals: number;
  processedObjects: number;
  missingOriginals: number;
  checksumMismatches: number;
  missingProcessedObjects: number;
  fingerprint: string | null;
};

export type AcceptanceSnapshot = {
  format: typeof ACCEPTANCE_SNAPSHOT_FORMAT;
  capturedAt: string;
  application: {
    version: string;
    configuredVersion: string;
    commit: string;
    buildTime: string | null;
  };
  database: {
    schemaNameFingerprint: string;
    transactionReadOnly: boolean;
    expectedMigrations: AcceptanceMigrationIdentity[];
    appliedMigrations: AcceptanceMigrationIdentity[];
    failedMigrations: string[];
  };
  privacy: {
    algorithm: "HMAC-SHA-256";
    keyId: string;
    rawIdentifiersIncluded: false;
    secretsIncluded: false;
  };
  capabilities: Record<string, boolean>;
  stable: {
    tables: Record<string, AcceptanceFingerprint>;
    groups: Record<string, AcceptanceFingerprint>;
    overall: AcceptanceFingerprint;
  };
  integrity: Record<string, AcceptanceIntegrityCheck>;
  administratorContinuity: {
    eligibleAdministrators: number;
    state: "missing" | "redundancy_warning" | "healthy";
  };
  storage: AcceptanceStorageVerification;
  operations: Record<string, number>;
};

export type AcceptanceComparisonIssue = {
  code: string;
  subject: string;
  beforeRows?: number;
  afterRows?: number;
};

export type AcceptanceComparison = {
  format: typeof ACCEPTANCE_COMPARISON_FORMAT;
  comparedAt: string;
  status: "pass" | "fail";
  sourceVersion: string;
  targetVersion: string;
  issues: AcceptanceComparisonIssue[];
  warnings: AcceptanceComparisonIssue[];
  privacy: {
    rawIdentifiersIncluded: false;
    secretsIncluded: false;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
}

function assertExactKeys(
  value: Record<string, unknown>,
  path: string,
  expectedKeys: readonly string[],
): void {
  const expected = new Set(expectedKeys);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  if (unknown.length > 0) {
    throw new Error(`${path} has unknown field(s): ${unknown.sort().join(", ")}`);
  }
  const missing = expectedKeys.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new Error(`${path} is missing required field(s): ${missing.join(", ")}`);
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
}

function assertCount(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative safe integer`);
  }
}

function assertFingerprint(value: unknown, path: string): asserts value is AcceptanceFingerprint {
  assertRecord(value, path);
  assertExactKeys(value, path, ["rows", "digest"]);
  assertCount(value.rows, `${path}.rows`);
  if (typeof value.digest !== "string" || !digestPattern.test(value.digest)) {
    throw new Error(`${path}.digest must be an HMAC-SHA-256 digest`);
  }
}

function parseMigrationList(value: unknown, path: string): AcceptanceMigrationIdentity[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) => {
    assertRecord(item, `${path}[${index}]`);
    assertExactKeys(item, `${path}[${index}]`, ["migrationName", "checksum"]);
    assertString(item.migrationName, `${path}[${index}].migrationName`);
    if (typeof item.checksum !== "string" || !checksumPattern.test(item.checksum)) {
      throw new Error(`${path}[${index}].checksum must be a SHA-256 checksum`);
    }
    return { migrationName: item.migrationName, checksum: item.checksum };
  });
}

function parseFingerprintRecord(
  value: unknown,
  path: string,
  names: readonly string[],
): Record<string, AcceptanceFingerprint> {
  assertRecord(value, path);
  assertExactKeys(value, path, names);
  const result: Record<string, AcceptanceFingerprint> = {};
  for (const [name, fingerprint] of Object.entries(value)) {
    assertFingerprint(fingerprint, `${path}.${name}`);
    result[name] = fingerprint;
  }
  return result;
}

function parseIntegrityRecord(
  value: unknown,
  path: string,
  names: readonly string[],
): Record<string, AcceptanceIntegrityCheck> {
  assertRecord(value, path);
  assertExactKeys(value, path, names);
  const result: Record<string, AcceptanceIntegrityCheck> = {};
  for (const [name, check] of Object.entries(value)) {
    assertRecord(check, `${path}.${name}`);
    assertExactKeys(check, `${path}.${name}`, ["applicable", "ok", "violations"]);
    assertBoolean(check.applicable, `${path}.${name}.applicable`);
    assertBoolean(check.ok, `${path}.${name}.ok`);
    assertCount(check.violations, `${path}.${name}.violations`);
    if (check.ok !== (!check.applicable || check.violations === 0)) {
      throw new Error(`${path}.${name} has an inconsistent result`);
    }
    result[name] = {
      applicable: check.applicable,
      ok: check.ok,
      violations: check.violations,
    };
  }
  return result;
}

export function parseAcceptanceSnapshot(value: unknown): AcceptanceSnapshot {
  assertRecord(value, "snapshot");
  assertExactKeys(value, "snapshot", [
    "format",
    "capturedAt",
    "application",
    "database",
    "privacy",
    "capabilities",
    "stable",
    "integrity",
    "administratorContinuity",
    "storage",
    "operations",
  ]);
  if (value.format !== ACCEPTANCE_SNAPSHOT_FORMAT) {
    throw new Error(`Unsupported acceptance snapshot format: ${String(value.format)}`);
  }
  assertString(value.capturedAt, "snapshot.capturedAt");
  if (!Number.isFinite(Date.parse(value.capturedAt))) {
    throw new Error("snapshot.capturedAt must be an RFC 3339 timestamp");
  }

  assertRecord(value.application, "snapshot.application");
  assertExactKeys(value.application, "snapshot.application", [
    "version",
    "configuredVersion",
    "commit",
    "buildTime",
  ]);
  assertString(value.application.version, "snapshot.application.version");
  assertString(value.application.configuredVersion, "snapshot.application.configuredVersion");
  assertString(value.application.commit, "snapshot.application.commit");
  if (value.application.buildTime !== null) {
    assertString(value.application.buildTime, "snapshot.application.buildTime");
  }

  assertRecord(value.database, "snapshot.database");
  assertExactKeys(value.database, "snapshot.database", [
    "schemaNameFingerprint",
    "transactionReadOnly",
    "expectedMigrations",
    "appliedMigrations",
    "failedMigrations",
  ]);
  if (
    typeof value.database.schemaNameFingerprint !== "string" ||
    !digestPattern.test(value.database.schemaNameFingerprint)
  ) {
    throw new Error("snapshot.database.schemaNameFingerprint must be an HMAC-SHA-256 digest");
  }
  assertBoolean(value.database.transactionReadOnly, "snapshot.database.transactionReadOnly");
  const expectedMigrations = parseMigrationList(
    value.database.expectedMigrations,
    "snapshot.database.expectedMigrations",
  );
  const appliedMigrations = parseMigrationList(
    value.database.appliedMigrations,
    "snapshot.database.appliedMigrations",
  );
  if (!Array.isArray(value.database.failedMigrations)) {
    throw new Error("snapshot.database.failedMigrations must be an array");
  }
  const failedMigrations = value.database.failedMigrations.map((migration, index) => {
    assertString(migration, `snapshot.database.failedMigrations[${index}]`);
    return migration;
  });

  assertRecord(value.privacy, "snapshot.privacy");
  assertExactKeys(value.privacy, "snapshot.privacy", [
    "algorithm",
    "keyId",
    "rawIdentifiersIncluded",
    "secretsIncluded",
  ]);
  if (value.privacy.algorithm !== "HMAC-SHA-256") {
    throw new Error("snapshot.privacy.algorithm must be HMAC-SHA-256");
  }
  if (typeof value.privacy.keyId !== "string" || !digestPattern.test(value.privacy.keyId)) {
    throw new Error("snapshot.privacy.keyId must be an HMAC-SHA-256 digest");
  }
  if (value.privacy.rawIdentifiersIncluded !== false || value.privacy.secretsIncluded !== false) {
    throw new Error("Acceptance snapshots must not contain raw identifiers or secrets");
  }

  assertRecord(value.capabilities, "snapshot.capabilities");
  assertExactKeys(value.capabilities, "snapshot.capabilities", ACCEPTANCE_CAPABILITY_NAMES);
  const capabilities: Record<string, boolean> = {};
  for (const [name, present] of Object.entries(value.capabilities)) {
    assertBoolean(present, `snapshot.capabilities.${name}`);
    capabilities[name] = present;
  }

  assertRecord(value.stable, "snapshot.stable");
  assertExactKeys(value.stable, "snapshot.stable", ["tables", "groups", "overall"]);
  const tables = parseFingerprintRecord(
    value.stable.tables,
    "snapshot.stable.tables",
    ACCEPTANCE_STABLE_TABLE_NAMES,
  );
  const groups = parseFingerprintRecord(
    value.stable.groups,
    "snapshot.stable.groups",
    ACCEPTANCE_STABLE_GROUP_NAMES,
  );
  assertFingerprint(value.stable.overall, "snapshot.stable.overall");
  const integrity = parseIntegrityRecord(
    value.integrity,
    "snapshot.integrity",
    ACCEPTANCE_INTEGRITY_NAMES,
  );

  assertRecord(value.administratorContinuity, "snapshot.administratorContinuity");
  assertExactKeys(value.administratorContinuity, "snapshot.administratorContinuity", [
    "eligibleAdministrators",
    "state",
  ]);
  assertCount(
    value.administratorContinuity.eligibleAdministrators,
    "snapshot.administratorContinuity.eligibleAdministrators",
  );
  if (
    !(["missing", "redundancy_warning", "healthy"] as const).includes(
      value.administratorContinuity.state as "missing" | "redundancy_warning" | "healthy",
    )
  ) {
    throw new Error("snapshot.administratorContinuity.state is invalid");
  }

  assertRecord(value.storage, "snapshot.storage");
  assertExactKeys(value.storage, "snapshot.storage", [
    "requested",
    "ok",
    "originals",
    "processedObjects",
    "missingOriginals",
    "checksumMismatches",
    "missingProcessedObjects",
    "fingerprint",
  ]);
  assertBoolean(value.storage.requested, "snapshot.storage.requested");
  if (value.storage.ok !== null) assertBoolean(value.storage.ok, "snapshot.storage.ok");
  for (const field of [
    "originals",
    "processedObjects",
    "missingOriginals",
    "checksumMismatches",
    "missingProcessedObjects",
  ] as const) {
    assertCount(value.storage[field], `snapshot.storage.${field}`);
  }
  if (value.storage.fingerprint !== null) {
    if (
      typeof value.storage.fingerprint !== "string" ||
      !digestPattern.test(value.storage.fingerprint)
    ) {
      throw new Error("snapshot.storage.fingerprint must be an HMAC-SHA-256 digest or null");
    }
  }

  assertRecord(value.operations, "snapshot.operations");
  assertExactKeys(value.operations, "snapshot.operations", ACCEPTANCE_OPERATION_NAMES);
  const operations: Record<string, number> = {};
  for (const [name, count] of Object.entries(value.operations)) {
    assertCount(count, `snapshot.operations.${name}`);
    operations[name] = count;
  }

  return {
    format: ACCEPTANCE_SNAPSHOT_FORMAT,
    capturedAt: value.capturedAt,
    application: {
      version: value.application.version,
      configuredVersion: value.application.configuredVersion,
      commit: value.application.commit,
      buildTime: value.application.buildTime as string | null,
    },
    database: {
      schemaNameFingerprint: value.database.schemaNameFingerprint,
      transactionReadOnly: value.database.transactionReadOnly,
      expectedMigrations,
      appliedMigrations,
      failedMigrations,
    },
    privacy: {
      algorithm: "HMAC-SHA-256",
      keyId: value.privacy.keyId,
      rawIdentifiersIncluded: false,
      secretsIncluded: false,
    },
    capabilities,
    stable: { tables, groups, overall: value.stable.overall },
    integrity,
    administratorContinuity: {
      eligibleAdministrators: value.administratorContinuity.eligibleAdministrators,
      state: value.administratorContinuity.state as "missing" | "redundancy_warning" | "healthy",
    },
    storage: value.storage as AcceptanceStorageVerification,
    operations,
  };
}

function migrationListsEqual(
  left: AcceptanceMigrationIdentity[],
  right: AcceptanceMigrationIdentity[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (migration, index) =>
        migration.migrationName === right[index]?.migrationName &&
        migration.checksum === right[index]?.checksum,
    )
  );
}

function migrationListIsPrefix(
  prefix: AcceptanceMigrationIdentity[],
  complete: AcceptanceMigrationIdentity[],
): boolean {
  return prefix.every(
    (migration, index) =>
      migration.migrationName === complete[index]?.migrationName &&
      migration.checksum === complete[index]?.checksum,
  );
}

function sameNames(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftNames = Object.keys(left).sort();
  const rightNames = Object.keys(right).sort();
  return (
    leftNames.length === rightNames.length &&
    leftNames.every((name, index) => name === rightNames[index])
  );
}

export function compareAcceptanceSnapshots(
  beforeValue: unknown,
  afterValue: unknown,
  comparedAt = new Date().toISOString(),
): AcceptanceComparison {
  const before = parseAcceptanceSnapshot(beforeValue);
  const after = parseAcceptanceSnapshot(afterValue);
  const issues: AcceptanceComparisonIssue[] = [];
  const warnings: AcceptanceComparisonIssue[] = [];
  const issue = (code: string, subject: string, rows?: { before: number; after: number }) => {
    issues.push({
      code,
      subject,
      ...(rows ? { beforeRows: rows.before, afterRows: rows.after } : {}),
    });
  };

  if (!before.database.transactionReadOnly || !after.database.transactionReadOnly) {
    issue("snapshot_not_read_only", "database.transactionReadOnly");
  }
  if (before.privacy.keyId !== after.privacy.keyId) {
    issue("fingerprint_key_changed", "privacy.keyId");
  }
  if (before.database.schemaNameFingerprint !== after.database.schemaNameFingerprint) {
    issue("database_schema_name_changed", "database.schemaNameFingerprint");
  }
  if (
    before.application.version !== after.application.version ||
    before.application.commit !== after.application.commit
  ) {
    issue("candidate_image_changed", "application");
  }
  if (after.application.configuredVersion !== after.application.version) {
    issue("target_version_mismatch", "application.configuredVersion");
  }
  if (!migrationListsEqual(before.database.expectedMigrations, after.database.expectedMigrations)) {
    issue("migration_contract_changed", "database.expectedMigrations");
  }
  if (!migrationListIsPrefix(before.database.appliedMigrations, after.database.appliedMigrations)) {
    issue("migration_history_rewritten", "database.appliedMigrations");
  }
  if (!migrationListsEqual(after.database.appliedMigrations, after.database.expectedMigrations)) {
    issue("target_migrations_incomplete", "database.appliedMigrations");
  }
  if (before.database.failedMigrations.length > 0 || after.database.failedMigrations.length > 0) {
    issue("failed_migration_present", "database.failedMigrations");
  }

  for (const [name, present] of Object.entries(after.capabilities)) {
    if (!present) issue("target_schema_capability_missing", `capabilities.${name}`);
  }

  for (const [phase, snapshot] of [
    ["before", before],
    ["after", after],
  ] as const) {
    for (const [name, check] of Object.entries(snapshot.integrity)) {
      if (check.applicable && !check.ok) {
        issue("integrity_violation", `${phase}.${name}`, {
          before: phase === "before" ? check.violations : 0,
          after: phase === "after" ? check.violations : 0,
        });
      }
    }
  }

  if (!sameNames(before.stable.tables, after.stable.tables)) {
    issue("stable_table_contract_changed", "stable.tables");
  }
  for (const name of Object.keys(before.stable.tables).sort()) {
    const beforeFingerprint = before.stable.tables[name];
    const afterFingerprint = after.stable.tables[name];
    if (!beforeFingerprint || !afterFingerprint) continue;
    if (
      beforeFingerprint.rows !== afterFingerprint.rows ||
      beforeFingerprint.digest !== afterFingerprint.digest
    ) {
      issue("stable_data_changed", name, {
        before: beforeFingerprint.rows,
        after: afterFingerprint.rows,
      });
    }
  }
  if (!sameNames(before.stable.groups, after.stable.groups)) {
    issue("stable_group_contract_changed", "stable.groups");
  }
  if (
    before.stable.overall.rows !== after.stable.overall.rows ||
    before.stable.overall.digest !== after.stable.overall.digest
  ) {
    issue("stable_aggregate_changed", "stable.overall", {
      before: before.stable.overall.rows,
      after: after.stable.overall.rows,
    });
  }

  if (before.storage.requested !== after.storage.requested) {
    issue("storage_verification_mode_changed", "storage.requested");
  }
  if (before.storage.requested && after.storage.requested) {
    if (!before.storage.ok || !after.storage.ok) {
      issue("storage_verification_failed", "storage.ok");
    }
    if (before.storage.fingerprint !== after.storage.fingerprint) {
      issue("storage_objects_changed", "storage.fingerprint");
    }
  }

  if (
    before.administratorContinuity.eligibleAdministrators !==
    after.administratorContinuity.eligibleAdministrators
  ) {
    issue("administrator_continuity_changed", "administratorContinuity");
  }
  if (after.administratorContinuity.eligibleAdministrators === 0) {
    issue("administrator_continuity_missing", "administratorContinuity");
  } else if (after.administratorContinuity.eligibleAdministrators === 1) {
    warnings.push({
      code: "administrator_redundancy_missing",
      subject: "administratorContinuity",
    });
  }

  return {
    format: ACCEPTANCE_COMPARISON_FORMAT,
    comparedAt,
    status: issues.length === 0 ? "pass" : "fail",
    sourceVersion: before.application.configuredVersion,
    targetVersion: after.application.configuredVersion,
    issues,
    warnings,
    privacy: { rawIdentifiersIncluded: false, secretsIncluded: false },
  };
}
