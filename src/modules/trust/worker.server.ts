import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { TRUST_RECALCULATION_CHUNK_SIZE } from "@/modules/trust/contracts";
import { evaluateTrustUser, queueTrustBatch } from "@/modules/trust/trust.server";
import { getErrorMessage } from "@/shared/errors/error-message";

type CountMap = Record<string, number>;
type BatchSummary = { from: CountMap; to: CountMap; transitions: CountMap };

function countMap(value: unknown): CountMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] >= 0,
    ),
  );
}

function batchSummary(value: Prisma.JsonValue): BatchSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { from: {}, to: {}, transitions: {} };
  }
  return {
    from: countMap(value.from),
    to: countMap(value.to),
    transitions: countMap(value.transitions),
  };
}

function increment(target: CountMap, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

export async function processTrustRecalculationChunk(
  transaction: Prisma.TransactionClient,
  batchId: string,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "trust_recalculation_batches"
      WHERE "id" = CAST(${batchId} AS uuid) FOR UPDATE`,
  );
  const batch = await transaction.trustRecalculationBatch.findUnique({
    where: { id: batchId },
    include: { ruleVersion: true },
  });
  if (!batch) throw new Error(`Trust recalculation batch not found: ${batchId}`);
  if (batch.status === "completed") return { batchId, status: "completed" };

  const now = new Date();
  if (batch.status === "pending" || batch.status === "failed") {
    await transaction.trustRecalculationBatch.update({
      where: { id: batch.id },
      data: { status: "running", startedAt: now, lastError: null },
    });
  }
  const users = await transaction.user.findMany({
    where: { uid: { gt: batch.cursorUid } },
    orderBy: { uid: "asc" },
    take: TRUST_RECALCULATION_CHUNK_SIZE,
    select: { id: true, uid: true },
  });
  const summary = batchSummary(batch.summary);
  let changed = 0;
  for (const user of users) {
    const result = await evaluateTrustUser(transaction, {
      userId: user.id,
      rule: batch.ruleVersion,
      mode: batch.mode as "preview" | "apply",
      source: "rule_apply",
      batchId: batch.id,
      now,
    });
    if (result.changed) changed += 1;
    increment(summary.from, String(result.previousCurrentLevel));
    increment(summary.to, String(result.evaluation.currentLevel));
    increment(summary.transitions, result.evaluation.transition);
  }
  const processedUsers = batch.processedUsers + users.length;
  const cursorUid = users.at(-1)?.uid ?? batch.cursorUid;
  const completed = users.length < TRUST_RECALCULATION_CHUNK_SIZE;
  await transaction.trustRecalculationBatch.update({
    where: { id: batch.id },
    data: {
      status: completed ? "completed" : "running",
      processedUsers,
      totalUsers: Math.max(batch.totalUsers, processedUsers),
      changedUsers: batch.changedUsers + changed,
      cursorUid,
      summary,
      completedAt: completed ? now : null,
      lastError: null,
    },
  });
  if (completed) {
    if (batch.mode === "preview" && ["draft", "previewed"].includes(batch.ruleVersion.status)) {
      await transaction.trustRuleVersion.update({
        where: { id: batch.ruleVersionId },
        data: { status: "previewed" },
      });
    }
  } else {
    await queueTrustBatch(transaction, batch.id, cursorUid);
  }
  return { batchId, status: completed ? "completed" : "running", processed: users.length };
}

export async function markTrustRecalculationFailed(batchId: string, error: unknown): Promise<void> {
  await getPrismaClient().trustRecalculationBatch.updateMany({
    where: { id: batchId, status: { in: ["pending", "running"] } },
    data: {
      status: "failed",
      lastError: getErrorMessage(error).slice(0, 8_000),
      completedAt: null,
    },
  });
}
