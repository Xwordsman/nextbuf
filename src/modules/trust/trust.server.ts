import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { createOutboxEvent } from "@/infrastructure/outbox/create-event";
import {
  governanceActorRoles,
  requireSiteAdmin,
  writeGovernanceAudit,
} from "@/modules/moderation/governance.server";
import { TRUST_RECALCULATION_TOPIC } from "@/modules/trust/contracts";
import { TrustError } from "@/modules/trust/errors";
import { collectTrustMetrics } from "@/modules/trust/metrics.server";
import {
  evaluateTrustTransition,
  parseTrustRuleConfig,
  type TrustEvaluation,
  type TrustMetrics,
  type TrustRuleConfig,
} from "@/modules/trust/policy";

type AutomaticLevel = 0 | 1 | 2 | 3;

function automaticLevel(value: number): AutomaticLevel {
  return value >= 3 ? 3 : value >= 2 ? 2 : value >= 1 ? 1 : 0;
}

function manualLevel(value: number | null): 4 | null {
  return value === 4 ? 4 : null;
}

function metricsJson(metrics: TrustMetrics): Prisma.InputJsonObject {
  return { ...metrics };
}

function explanationJson(ruleVersion: number, evaluation: TrustEvaluation): Prisma.InputJsonObject {
  return {
    ruleVersion,
    candidateLevel: evaluation.candidateLevel,
    automatedLevel: evaluation.automatedLevel,
    currentLevel: evaluation.currentLevel,
    transition: evaluation.transition,
    graceUntil: evaluation.graceUntil?.toISOString() ?? null,
    checks: evaluation.checks.map((check) => ({
      level: check.level,
      met: check.met,
      requirements: { ...check.requirements },
    })),
  };
}

export async function queueTrustBatch(
  transaction: Prisma.TransactionClient,
  batchId: string,
  cursorUid = 0,
): Promise<void> {
  await createOutboxEvent(transaction, {
    topic: TRUST_RECALCULATION_TOPIC,
    idempotencyKey: `trust-recalculation:${batchId}:${cursorUid}`,
    payload: { batchId, cursorUid },
  });
}

export async function evaluateTrustUser(
  transaction: Prisma.TransactionClient,
  input: {
    userId: string;
    rule: { id: string; version: number; config: Prisma.JsonValue };
    mode: "preview" | "apply";
    source: "automatic" | "rule_apply";
    batchId?: string;
    now: Date;
  },
) {
  const config = parseTrustRuleConfig(input.rule.config);
  const [metrics, existing] = await Promise.all([
    collectTrustMetrics(transaction, input.userId, config.violationWindowDays, input.now),
    transaction.trustUserState.findUnique({ where: { userId: input.userId } }),
  ]);
  const previousAutomatedLevel = automaticLevel(existing?.automatedLevel ?? 0);
  const previousCurrentLevel = existing?.currentLevel ?? 0;
  const evaluation = evaluateTrustTransition({
    metrics,
    rule: config,
    previousAutomatedLevel,
    manualLevel: manualLevel(existing?.manualLevel ?? null),
    graceUntil: existing?.graceUntil ?? null,
    now: input.now,
  });
  const explanation = explanationJson(input.rule.version, evaluation);
  const changed =
    evaluation.currentLevel !== previousCurrentLevel ||
    evaluation.automatedLevel !== previousAutomatedLevel;

  if (input.mode === "apply") {
    await transaction.trustUserState.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        currentLevel: evaluation.currentLevel,
        automatedLevel: evaluation.automatedLevel,
        manualLevel: existing?.manualLevel,
        ruleVersionId: input.rule.id,
        metrics: metricsJson(metrics),
        explanation,
        graceUntil: evaluation.graceUntil,
        calculatedAt: input.now,
      },
      update: {
        currentLevel: evaluation.currentLevel,
        automatedLevel: evaluation.automatedLevel,
        ruleVersionId: input.rule.id,
        metrics: metricsJson(metrics),
        explanation,
        graceUntil: evaluation.graceUntil,
        calculatedAt: input.now,
      },
    });
    if (changed || evaluation.transition === "grace_started") {
      await transaction.trustLevelHistory.create({
        data: {
          userId: input.userId,
          ruleVersionId: input.rule.id,
          batchId: input.batchId,
          fromLevel: previousCurrentLevel,
          toLevel: evaluation.currentLevel,
          automatedLevel: evaluation.automatedLevel,
          source: evaluation.transition === "grace_started" ? "grace" : input.source,
          reason: explanation,
          metrics: metricsJson(metrics),
        },
      });
    }
  }

  return { metrics, evaluation, previousCurrentLevel, changed };
}

async function createBatch(
  transaction: Prisma.TransactionClient,
  input: { ruleVersionId: string; requestedById?: string; mode: "preview" | "apply" },
) {
  const totalUsers = await transaction.user.count();
  const batch = await transaction.trustRecalculationBatch.create({
    data: {
      ruleVersionId: input.ruleVersionId,
      requestedById: input.requestedById,
      mode: input.mode,
      totalUsers,
      summary: { from: {}, to: {}, transitions: {} },
    },
  });
  await queueTrustBatch(transaction, batch.id);
  return batch;
}

export async function createTrustRuleDraft(input: {
  actorId: string;
  config: unknown;
  reason: string;
  requestId: string;
}) {
  const config: TrustRuleConfig = parseTrustRuleConfig(input.config);
  return getPrismaClient().$transaction(async (transaction) => {
    const permissions = await requireSiteAdmin(transaction, input.actorId);
    const rule = await transaction.trustRuleVersion.create({
      data: { status: "draft", config, createdById: input.actorId },
    });
    await writeGovernanceAudit(transaction, {
      actorId: input.actorId,
      actorRoles: governanceActorRoles(permissions),
      action: "trust_rule.draft.created",
      targetType: "trust_rule",
      targetKey: rule.id,
      reason: input.reason,
      beforeState: { exists: false },
      afterState: { exists: true, version: rule.version, status: rule.status },
      requestId: input.requestId,
    });
    return rule;
  });
}

export async function previewTrustRule(input: {
  actorId: string;
  ruleId: string;
  reason: string;
  requestId: string;
}) {
  return getPrismaClient().$transaction(async (transaction) => {
    const permissions = await requireSiteAdmin(transaction, input.actorId);
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "trust_rule_versions"
        WHERE "id" = CAST(${input.ruleId} AS uuid) FOR UPDATE`,
    );
    const rule = await transaction.trustRuleVersion.findUnique({ where: { id: input.ruleId } });
    if (!rule) throw new TrustError("rule_not_found", 404);
    if (!["draft", "previewed"].includes(rule.status)) {
      throw new TrustError("invalid_rule_state", 409);
    }
    const inflight = await transaction.trustRecalculationBatch.findFirst({
      where: { ruleVersionId: rule.id, mode: "preview", status: { in: ["pending", "running"] } },
    });
    if (inflight) throw new TrustError("batch_in_progress", 409);
    const batch = await createBatch(transaction, {
      ruleVersionId: rule.id,
      requestedById: input.actorId,
      mode: "preview",
    });
    await writeGovernanceAudit(transaction, {
      actorId: input.actorId,
      actorRoles: governanceActorRoles(permissions),
      action: "trust_rule.preview.started",
      targetType: "trust_rule",
      targetKey: rule.id,
      reason: input.reason,
      beforeState: { status: rule.status },
      afterState: { status: rule.status, batchId: batch.id },
      requestId: input.requestId,
    });
    return batch;
  });
}

export async function activateTrustRule(input: {
  actorId: string;
  ruleId: string;
  reason: string;
  requestId: string;
}) {
  return getPrismaClient().$transaction(async (transaction) => {
    const permissions = await requireSiteAdmin(transaction, input.actorId);
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "trust_rule_versions"
        WHERE "status" IN ('active', 'previewed') ORDER BY "version" FOR UPDATE`,
    );
    const rule = await transaction.trustRuleVersion.findUnique({ where: { id: input.ruleId } });
    if (!rule) throw new TrustError("rule_not_found", 404);
    const preview = await transaction.trustRecalculationBatch.findFirst({
      where: { ruleVersionId: rule.id, mode: "preview", status: "completed" },
      orderBy: { completedAt: "desc" },
    });
    if (!preview) throw new TrustError("preview_required", 409);
    if (rule.status !== "previewed") throw new TrustError("invalid_rule_state", 409);
    const applyInProgress = await transaction.trustRecalculationBatch.findFirst({
      where: { mode: "apply", status: { in: ["pending", "running"] } },
      select: { id: true },
    });
    if (applyInProgress) throw new TrustError("batch_in_progress", 409);
    const previous = await transaction.trustRuleVersion.findFirst({ where: { status: "active" } });
    if (previous) {
      await transaction.trustRuleVersion.update({
        where: { id: previous.id },
        data: { status: "retired" },
      });
    }
    const activatedAt = new Date();
    const active = await transaction.trustRuleVersion.update({
      where: { id: rule.id },
      data: { status: "active", activatedAt },
    });
    const batch = await createBatch(transaction, {
      ruleVersionId: rule.id,
      requestedById: input.actorId,
      mode: "apply",
    });
    await writeGovernanceAudit(transaction, {
      actorId: input.actorId,
      actorRoles: governanceActorRoles(permissions),
      action: "trust_rule.activated",
      targetType: "trust_rule",
      targetKey: rule.id,
      reason: input.reason,
      beforeState: { activeRuleId: previous?.id ?? null, status: rule.status },
      afterState: { activeRuleId: rule.id, status: active.status, batchId: batch.id },
      requestId: input.requestId,
    });
    return { rule: active, batch };
  });
}

export async function setManualTrustLevel(input: {
  actorId: string;
  userId: string;
  level: 4 | null;
  reason: string;
  requestId: string;
}): Promise<void> {
  await getPrismaClient().$transaction(async (transaction) => {
    const permissions = await requireSiteAdmin(transaction, input.actorId);
    await transaction.$queryRaw(
      Prisma.sql`SELECT "user_id" FROM "trust_user_states"
        WHERE "user_id" = CAST(${input.userId} AS uuid) FOR UPDATE`,
    );
    const state = await transaction.trustUserState.findUnique({ where: { userId: input.userId } });
    if (!state) throw new TrustError("user_not_found", 404);
    if (state.manualLevel === input.level) return;
    const nextLevel = input.level ?? state.automatedLevel;
    const source = input.level === 4 ? "manual_tl4" : "manual_tl4_revoked";
    await transaction.trustUserState.update({
      where: { userId: input.userId },
      data: { manualLevel: input.level, currentLevel: nextLevel },
    });
    await transaction.trustLevelHistory.create({
      data: {
        userId: input.userId,
        ruleVersionId: state.ruleVersionId,
        actorId: input.actorId,
        fromLevel: state.currentLevel,
        toLevel: nextLevel,
        automatedLevel: state.automatedLevel,
        source,
        reason: { reason: input.reason, source },
        metrics: state.metrics as Prisma.InputJsonValue,
      },
    });
    await writeGovernanceAudit(transaction, {
      actorId: input.actorId,
      actorRoles: governanceActorRoles(permissions),
      action: input.level === 4 ? "trust.tl4.granted" : "trust.tl4.revoked",
      targetType: "user",
      targetKey: input.userId,
      reason: input.reason,
      beforeState: { currentLevel: state.currentLevel, manualLevel: state.manualLevel },
      afterState: { currentLevel: nextLevel, manualLevel: input.level },
      requestId: input.requestId,
    });
  });
}

export async function getTrustOverview(userId: string) {
  return getPrismaClient().trustUserState.findUnique({
    where: { userId },
    include: {
      ruleVersion: { select: { version: true, config: true } },
      user: { select: { uid: true, username: true, name: true } },
    },
  });
}

export async function getTrustHistory(userId: string) {
  return getPrismaClient().trustLevelHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { ruleVersion: { select: { version: true } } },
  });
}

export async function getTrustGovernanceOverview(actorId: string) {
  return getPrismaClient().$transaction(async (transaction) => {
    await requireSiteAdmin(transaction, actorId);
    const [rules, batches] = await Promise.all([
      transaction.trustRuleVersion.findMany({
        orderBy: { version: "desc" },
        take: 20,
      }),
      transaction.trustRecalculationBatch.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    return { rules, batches };
  });
}

export async function getTrustBatchAsAdmin(actorId: string, batchId: string) {
  return getPrismaClient().$transaction(async (transaction) => {
    await requireSiteAdmin(transaction, actorId);
    const batch = await transaction.trustRecalculationBatch.findUnique({
      where: { id: batchId },
      include: { ruleVersion: { select: { version: true, status: true } } },
    });
    if (!batch) throw new TrustError("rule_not_found", 404);
    return batch;
  });
}

export async function scheduleDailyTrustRecalculation(): Promise<string | null> {
  return getPrismaClient().$transaction(async (transaction) => {
    const activeRule = await transaction.trustRuleVersion.findFirst({
      where: { status: "active" },
    });
    if (!activeRule) return null;
    const inflight = await transaction.trustRecalculationBatch.findFirst({
      where: {
        ruleVersionId: activeRule.id,
        mode: "apply",
        status: { in: ["pending", "running"] },
      },
    });
    if (inflight) return inflight.id;
    return (await createBatch(transaction, { ruleVersionId: activeRule.id, mode: "apply" })).id;
  });
}
