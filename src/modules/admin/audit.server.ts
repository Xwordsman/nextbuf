import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";
import { requireAdministrator } from "@/modules/admin/authorization.server";
import {
  requireConfirmation,
  requireElevatedSiteAdmin,
} from "@/modules/admin/reauthentication.server";
import { managedTopicWhere } from "@/modules/community/topic-visibility";
import { governanceActorRoles, writeGovernanceAudit } from "@/modules/moderation/governance.server";
import { AUDIT_EXPORT_CONFIRMATION } from "@/shared/admin-contracts";

const sensitiveKey =
  /authorization|cookie|password|secret|token|database.?url|redis.?url|ciphertext/i;

export type AuditSource = "identity" | "community" | "governance";
export type AuditFilters = {
  source?: AuditSource | "all";
  action?: string;
  actorUid?: number;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

export type AdminAuditEvent = {
  id: string;
  source: AuditSource;
  action: string;
  actor: { uid: number; username: string; name: string } | null;
  targetType: string;
  targetKey: string;
  requestId: string | null;
  detail: unknown;
  createdAt: Date;
};

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redactAuditValue(item),
      ]),
    );
  }
  return value;
}

function dateWhere(input: AuditFilters) {
  return input.from || input.to
    ? {
        createdAt: {
          ...(input.from ? { gte: input.from } : {}),
          ...(input.to ? { lte: input.to } : {}),
        },
      }
    : {};
}

async function collectAuditEvents(input: AuditFilters, maxEvents: number) {
  const prisma = getPrismaClient();
  const source = input.source ?? "all";
  const actor = input.actorUid
    ? await prisma.user.findUnique({ where: { uid: input.actorUid }, select: { id: true } })
    : null;
  if (input.actorUid && !actor) return [];
  const actorId = actor?.id;
  const action = input.action?.trim();
  const includeSource = (candidate: AuditSource) => source === "all" || source === candidate;

  const [identity, community, governance] = await Promise.all([
    includeSource("identity")
      ? prisma.identityAuditEvent.findMany({
          where: {
            ...dateWhere(input),
            ...(actorId ? { userId: actorId } : {}),
            ...(action ? { eventType: { contains: action, mode: "insensitive" } } : {}),
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: maxEvents,
        })
      : Promise.resolve([]),
    includeSource("community")
      ? prisma.communityAuditEvent.findMany({
          where: {
            ...dateWhere(input),
            ...(actorId ? { actorId } : {}),
            ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
            OR: [{ topicId: null }, { topic: { is: managedTopicWhere() } }],
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: maxEvents,
          include: { topic: { select: { number: true } } },
        })
      : Promise.resolve([]),
    includeSource("governance")
      ? prisma.governanceAuditEvent.findMany({
          where: {
            ...dateWhere(input),
            ...(actorId ? { actorId } : {}),
            ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: maxEvents,
        })
      : Promise.resolve([]),
  ]);

  const actorIds = new Set<string>();
  for (const event of identity) if (event.userId) actorIds.add(event.userId);
  for (const event of community) if (event.actorId) actorIds.add(event.actorId);
  for (const event of governance) actorIds.add(event.actorId);
  const actors = await prisma.user.findMany({
    where: { id: { in: [...actorIds] } },
    select: { id: true, uid: true, username: true, name: true },
  });
  const actorById = new Map(actors.map(({ id, ...item }) => [id, item]));

  const events: AdminAuditEvent[] = [
    ...identity.map((event) => ({
      id: `identity:${event.id}`,
      source: "identity" as const,
      action: event.eventType,
      actor: event.userId ? (actorById.get(event.userId) ?? null) : null,
      targetType: event.sessionId ? "session" : "user",
      targetKey: event.sessionId ?? event.userId ?? "system",
      requestId: null,
      detail: redactAuditValue({ metadata: event.metadata, ipHash: event.ipHash }),
      createdAt: event.createdAt,
    })),
    ...community.map((event) => ({
      id: `community:${event.id}`,
      source: "community" as const,
      action: event.action,
      actor: event.actorId ? (actorById.get(event.actorId) ?? null) : null,
      targetType: event.postId
        ? "post"
        : event.topicId
          ? "topic"
          : event.nodeId
            ? "node"
            : "system",
      targetKey: event.postId ?? event.topic?.number.toString() ?? event.nodeId ?? "system",
      requestId: event.requestId,
      detail: redactAuditValue(event.metadata),
      createdAt: event.createdAt,
    })),
    ...governance.map((event) => ({
      id: `governance:${event.id}`,
      source: "governance" as const,
      action: event.action,
      actor: actorById.get(event.actorId) ?? null,
      targetType: event.targetType,
      targetKey: event.targetKey,
      requestId: event.requestId,
      detail: redactAuditValue({
        reason: event.reason,
        actorRoles: event.actorRoles,
        beforeState: event.beforeState,
        afterState: event.afterState,
      }),
      createdAt: event.createdAt,
    })),
  ];
  return events
    .sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
    )
    .slice(0, maxEvents);
}

export async function listAdminAuditEvents(actorId: string, input: AuditFilters) {
  const prisma = getPrismaClient();
  await prisma.$transaction((transaction) => requireAdministrator(transaction, actorId));
  const page = Math.min(Math.max(input.page ?? 1, 1), 20);
  const pageSize = Math.min(Math.max(input.pageSize ?? 50, 1), 100);
  const through = page * pageSize + 1;
  const all = await collectAuditEvents(input, through);
  const offset = (page - 1) * pageSize;
  return {
    items: all.slice(offset, offset + pageSize),
    page,
    pageSize,
    hasMore: all.length > offset + pageSize,
  };
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function auditEventsToCsv(events: AdminAuditEvent[]): string {
  const rows = [
    [
      "time",
      "source",
      "action",
      "actor_uid",
      "actor_username",
      "target_type",
      "target_key",
      "request_id",
      "detail",
    ],
    ...events.map((event) => [
      event.createdAt.toISOString(),
      event.source,
      event.action,
      event.actor?.uid ?? "",
      event.actor?.username ?? "",
      event.targetType,
      event.targetKey,
      event.requestId ?? "",
      JSON.stringify(event.detail),
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export async function exportAdminAuditEvents(input: {
  actorId: string;
  sessionId: string;
  confirmation: string;
  reason: string;
  requestId: string;
  filters: AuditFilters;
}) {
  requireConfirmation(input.confirmation, AUDIT_EXPORT_CONFIRMATION);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (transaction) => {
    const permissions = await requireElevatedSiteAdmin(transaction, input);
    await writeGovernanceAudit(transaction, {
      actorId: input.actorId,
      actorRoles: governanceActorRoles(permissions),
      action: "audit.exported",
      targetType: "audit_log",
      targetKey: input.filters.source ?? "all",
      reason: input.reason,
      beforeState: { exported: false },
      afterState: { exported: true, limit: 500 },
      requestId: input.requestId,
    });
  });
  const events = await collectAuditEvents(input.filters, 500);
  return { csv: auditEventsToCsv(events), count: events.length };
}
