import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "@/cli/commands/setup";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { AdminError } from "@/modules/admin/errors";
import { getAdminDashboard } from "@/modules/admin/dashboard.server";
import { exportAdminAuditEvents } from "@/modules/admin/audit.server";
import {
  bulkRevokeUserSessions,
  getAdminUserDetail,
  listAdminUsers,
} from "@/modules/admin/users.server";
import { getSiteSettings, updateSiteSettings } from "@/modules/settings/settings.server";
import {
  AUDIT_EXPORT_CONFIRMATION,
  BULK_SESSION_CONFIRMATION,
  SITE_SETTINGS_CONFIRMATION,
} from "@/shared/admin-contracts";

const emailPrefix = "admin-operations+";
const emailDomain = "@nextbuf.test";
const workerId = "admin-operations-worker";
let originalSettings: Awaited<ReturnType<typeof getSiteSettings>>;
let adminId = "";
let targetId = "";
let adminSessionId = "";

async function cleanup() {
  const prisma = getPrismaClient();
  const users = await prisma.user.findMany({
    where: { email: { startsWith: emailPrefix, endsWith: emailDomain } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;
  await prisma.governanceAuditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.communityRoleAssignment.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { grantedById: { in: ids } }] },
  });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

describe("administration settings, sessions and audit integration", () => {
  beforeAll(async () => {
    await setup();
    await cleanup();
    const prisma = getPrismaClient();
    originalSettings = await getSiteSettings();
    const [admin, target] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin Operations",
          username: "admin_operations",
          email: `${emailPrefix}admin${emailDomain}`,
          emailVerified: true,
          status: "active",
          activatedAt: new Date(),
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin Target",
          username: "admin_target",
          email: `${emailPrefix}target${emailDomain}`,
          emailVerified: true,
          status: "active",
          activatedAt: new Date(),
        },
      }),
    ]);
    adminId = admin.id;
    targetId = target.id;
    await prisma.communityRoleAssignment.create({
      data: {
        userId: admin.id,
        role: "admin",
        scopeKey: "site",
        reason: "admin operations integration",
      },
    });
    const adminSession = await prisma.session.create({
      data: {
        userId: admin.id,
        token: `admin-operations-${crypto.randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    adminSessionId = adminSession.id;
    await prisma.workerHeartbeat.upsert({
      where: { workerId },
      create: {
        workerId,
        status: "ready",
        version: "0.12.0",
        startedAt: new Date(),
        heartbeatAt: new Date(),
      },
      update: { status: "ready", heartbeatAt: new Date(), stoppedAt: null },
    });
    await prisma.session.createMany({
      data: [
        {
          userId: target.id,
          token: `admin-target-a-${crypto.randomUUID()}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        {
          userId: target.id,
          token: `admin-target-b-${crypto.randomUUID()}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      ],
    });
  });

  afterAll(async () => {
    const prisma = getPrismaClient();
    await prisma.workerHeartbeat.deleteMany({ where: { workerId } });
    if (originalSettings) {
      await prisma.siteSetting.update({
        where: { id: "site" },
        data: {
          siteName: originalSettings.siteName,
          registrationMode: originalSettings.registrationMode,
          topicsEnabled: originalSettings.topicsEnabled,
          repliesEnabled: originalSettings.repliesEnabled,
          uploadsEnabled: originalSettings.uploadsEnabled,
          maxTopicsPerHour: originalSettings.maxTopicsPerHour,
          maxRepliesPerHour: originalSettings.maxRepliesPerHour,
          maxUploadsPerHour: originalSettings.maxUploadsPerHour,
          revision: { increment: 1 },
          updatedById: null,
        },
      });
    }
    await cleanup();
    await disconnectPrismaClient();
  });

  it("binds high-risk setting writes to an elevated Better Auth session and revision", async () => {
    const current = await getSiteSettings();
    await expect(
      updateSiteSettings({
        actorId: adminId,
        sessionId: adminSessionId,
        expectedRevision: current.revision,
        confirmation: SITE_SETTINGS_CONFIRMATION,
        reason: "验证高风险设置边界",
        requestId: "admin-settings-no-reauth",
        settings: { ...current, siteName: "NextBuf Admin Test" },
      }),
    ).rejects.toMatchObject({ code: "reauthentication_required" });
    const now = new Date();
    await getPrismaClient().adminReauthentication.create({
      data: {
        sessionId: adminSessionId,
        verifiedAt: now,
        expiresAt: new Date(now.getTime() + 600_000),
      },
    });
    const updated = await updateSiteSettings({
      actorId: adminId,
      sessionId: adminSessionId,
      expectedRevision: current.revision,
      confirmation: SITE_SETTINGS_CONFIRMATION,
      reason: "验证设置修订和审计",
      requestId: "admin-settings-update",
      settings: { ...current, siteName: "NextBuf Admin Test", maxTopicsPerHour: 7 },
    });
    expect(updated).toMatchObject({
      siteName: "NextBuf Admin Test",
      maxTopicsPerHour: 7,
      revision: current.revision + 1,
    });
    await expect(
      updateSiteSettings({
        actorId: adminId,
        sessionId: adminSessionId,
        expectedRevision: current.revision,
        confirmation: SITE_SETTINGS_CONFIRMATION,
        reason: "验证旧修订被拒绝",
        requestId: "admin-settings-conflict",
        settings: { ...current, siteName: "Stale Settings" },
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    await expect(
      getPrismaClient().governanceAuditEvent.findFirstOrThrow({
        where: { requestId: "admin-settings-update" },
      }),
    ).resolves.toMatchObject({ action: "site_settings.updated", targetKey: "site" });
  });

  it("reports ready Worker heartbeats and operational alerts accurately", async () => {
    const dashboard = await getAdminDashboard(adminId);
    expect(dashboard.operations.activeWorkers).toBe(1);
    expect(dashboard.alerts.map((alert) => alert.code)).not.toContain("worker_unavailable");
  });

  it("paginates user administration and revokes target sessions in one authorized workflow", async () => {
    const listed = await listAdminUsers(adminId, { query: "admin_target", pageSize: 10 });
    expect(listed.items).toHaveLength(1);
    const detail = await getAdminUserDetail(adminId, listed.items[0]!.uid);
    expect(detail.sessions).toHaveLength(2);
    expect(detail.sessions[0]).not.toHaveProperty("token");
    const result = await bulkRevokeUserSessions({
      actorId: adminId,
      sessionId: adminSessionId,
      userIds: [targetId],
      confirmation: BULK_SESSION_CONFIRMATION,
      reason: "验证批量会话撤销",
      requestId: "admin-bulk-sessions",
    });
    expect(result).toEqual({ userCount: 1, revokedSessions: 2 });
    await expect(getPrismaClient().session.count({ where: { userId: targetId } })).resolves.toBe(0);
  });

  it("redacts sensitive audit values and controls export size", async () => {
    await getPrismaClient().governanceAuditEvent.create({
      data: {
        actorId: adminId,
        actorRoles: ["admin"],
        action: "admin.secret.fixture",
        targetType: "test",
        targetKey: "fixture",
        reason: "验证导出脱敏",
        beforeState: { accessToken: "do-not-export", safe: "visible" },
        afterState: { password: "also-secret" },
        requestId: "admin-audit-fixture",
      },
    });
    const exported = await exportAdminAuditEvents({
      actorId: adminId,
      sessionId: adminSessionId,
      confirmation: AUDIT_EXPORT_CONFIRMATION,
      reason: "验证受控审计导出",
      requestId: "admin-audit-export",
      filters: { source: "governance", action: "admin.secret.fixture" },
    });
    expect(exported.count).toBe(1);
    expect(exported.csv).toContain("[REDACTED]");
    expect(exported.csv).not.toContain("do-not-export");
    expect(exported.csv).not.toContain("also-secret");
  });

  it("rejects non-administrators from admin queries", async () => {
    await expect(listAdminUsers(targetId, {})).rejects.toBeInstanceOf(AdminError);
  });
});
