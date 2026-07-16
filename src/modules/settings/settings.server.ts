import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { AdminError } from "@/modules/admin/errors";
import {
  requireConfirmation,
  requireElevatedSiteAdmin,
} from "@/modules/admin/reauthentication.server";
import { governanceActorRoles, writeGovernanceAudit } from "@/modules/moderation/governance.server";
import {
  defaultSiteSettings,
  SITE_SETTINGS_ID,
  siteSettingsInputSchema,
  type SiteSettingsInput,
} from "@/modules/settings/contracts";
import { SITE_SETTINGS_CONFIRMATION } from "@/shared/admin-contracts";
import { runtimeEnv } from "@/shared/config/runtime-env";

type SettingsDatabase = Prisma.TransactionClient | ReturnType<typeof getPrismaClient>;

export type EffectiveSiteSettings = SiteSettingsInput & {
  revision: number;
  updatedAt: Date | null;
};

export async function getSiteSettings(
  database: SettingsDatabase = getPrismaClient(),
): Promise<EffectiveSiteSettings> {
  const row = await database.siteSetting.findUnique({ where: { id: SITE_SETTINGS_ID } });
  if (!row) return { ...defaultSiteSettings, revision: 0, updatedAt: null };
  return {
    siteName: row.siteName,
    registrationMode:
      row.revision === 1 && !row.updatedById
        ? runtimeEnv.AUTH_REGISTRATION_MODE
        : (row.registrationMode as SiteSettingsInput["registrationMode"]),
    topicsEnabled: row.topicsEnabled,
    repliesEnabled: row.repliesEnabled,
    uploadsEnabled: row.uploadsEnabled,
    maxTopicsPerHour: row.maxTopicsPerHour,
    maxRepliesPerHour: row.maxRepliesPerHour,
    maxUploadsPerHour: row.maxUploadsPerHour,
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

export async function updateSiteSettings(input: {
  actorId: string;
  sessionId: string;
  expectedRevision: number;
  confirmation: string;
  reason: string;
  requestId: string;
  settings: unknown;
}): Promise<EffectiveSiteSettings> {
  requireConfirmation(input.confirmation, SITE_SETTINGS_CONFIRMATION);
  const settings = siteSettingsInputSchema.parse(input.settings);
  return getPrismaClient().$transaction(async (transaction) => {
    const permissions = await requireElevatedSiteAdmin(transaction, input);
    await transaction.$queryRaw`SELECT "id" FROM "site_settings" WHERE "id" = 'site' FOR UPDATE`;
    const current = await transaction.siteSetting.findUnique({ where: { id: SITE_SETTINGS_ID } });
    if (!current || current.revision !== input.expectedRevision) {
      throw new AdminError("revision_conflict", 409, { currentRevision: current?.revision ?? 0 });
    }
    const updated = await transaction.siteSetting.update({
      where: { id: SITE_SETTINGS_ID },
      data: {
        ...settings,
        revision: { increment: 1 },
        updatedById: input.actorId,
      },
    });
    await writeGovernanceAudit(transaction, {
      actorId: input.actorId,
      actorRoles: governanceActorRoles(permissions),
      action: "site_settings.updated",
      targetType: "site_settings",
      targetKey: SITE_SETTINGS_ID,
      reason: input.reason,
      beforeState: {
        revision: current.revision,
        siteName: current.siteName,
        registrationMode: current.registrationMode,
        topicsEnabled: current.topicsEnabled,
        repliesEnabled: current.repliesEnabled,
        uploadsEnabled: current.uploadsEnabled,
        maxTopicsPerHour: current.maxTopicsPerHour,
        maxRepliesPerHour: current.maxRepliesPerHour,
        maxUploadsPerHour: current.maxUploadsPerHour,
      },
      afterState: { revision: updated.revision, ...settings },
      requestId: input.requestId,
    });
    return getSiteSettings(transaction);
  });
}
