import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";
import {
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_TYPES,
  type NotificationPreferenceView,
  type NotificationSnapshot,
  type NotificationType,
} from "@/modules/notifications/contracts";

function isType(value: string): value is NotificationType {
  return NOTIFICATION_TYPES.some((type) => type === value);
}

export class NotificationPreferencesError extends Error {
  constructor() {
    super("Invalid notification preference set");
  }
}

function snapshot(value: unknown): NotificationSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.actorName !== "string" ||
    typeof item.actorUsername !== "string" ||
    typeof item.topicNumber !== "number" ||
    typeof item.topicTitle !== "string"
  ) {
    return null;
  }
  return {
    actorName: item.actorName,
    actorUsername: item.actorUsername,
    topicNumber: item.topicNumber,
    topicTitle: item.topicTitle,
    postPosition: typeof item.postPosition === "number" ? item.postPosition : undefined,
    action: typeof item.action === "string" ? item.action : undefined,
  };
}

const visibleDelivery = { channel: "in_app", status: "delivered" };

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return getPrismaClient().notification.count({
    where: {
      recipientId: userId,
      readAt: null,
      archivedAt: null,
      deliveries: { some: visibleDelivery },
    },
  });
}

export async function listNotifications(userId: string, unreadOnly = false) {
  const records = await getPrismaClient().notification.findMany({
    where: {
      recipientId: userId,
      archivedAt: null,
      ...(unreadOnly ? { readAt: null } : {}),
      deliveries: { some: visibleDelivery },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    include: { actor: { select: { name: true, username: true, image: true } } },
  });
  return records.flatMap((record) => {
    const type = isType(record.type) ? record.type : null;
    const parsed = snapshot(record.snapshot);
    return type && parsed ? [{ ...record, type, snapshot: parsed }] : [];
  });
}

export async function markNotificationRead(userId: string, id: string): Promise<boolean> {
  const result = await getPrismaClient().notification.updateMany({
    where: { id, recipientId: userId, archivedAt: null },
    data: { readAt: new Date() },
  });
  return result.count === 1;
}

export async function archiveNotification(userId: string, id: string): Promise<boolean> {
  const now = new Date();
  const result = await getPrismaClient().notification.updateMany({
    where: { id, recipientId: userId, archivedAt: null },
    data: { readAt: now, archivedAt: now },
  });
  return result.count === 1;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await getPrismaClient().notification.updateMany({
    where: {
      recipientId: userId,
      readAt: null,
      archivedAt: null,
      deliveries: { some: visibleDelivery },
    },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationPreferenceView[]> {
  const rows = await getPrismaClient().notificationPreference.findMany({ where: { userId } });
  const byType = new Map(rows.map((row) => [row.type, row]));
  return NOTIFICATION_TYPES.map((type) => ({
    type,
    label: NOTIFICATION_TYPE_LABELS[type],
    inAppEnabled: byType.get(type)?.inAppEnabled ?? true,
    emailEnabled: byType.get(type)?.emailEnabled ?? false,
  }));
}

export async function updateNotificationPreferences(
  userId: string,
  preferences: Array<{
    type: NotificationType;
    inAppEnabled: boolean;
    emailEnabled: boolean;
  }>,
): Promise<void> {
  if (
    preferences.length !== NOTIFICATION_TYPES.length ||
    new Set(preferences.map(({ type }) => type)).size !== NOTIFICATION_TYPES.length ||
    preferences.some(({ type }) => !isType(type))
  ) {
    throw new NotificationPreferencesError();
  }
  await getPrismaClient().$transaction(
    preferences.map((preference) =>
      getPrismaClient().notificationPreference.upsert({
        where: { userId_type: { userId, type: preference.type } },
        create: { userId, ...preference },
        update: {
          inAppEnabled: preference.inAppEnabled,
          emailEnabled: preference.emailEnabled,
        },
      }),
    ),
  );
}
