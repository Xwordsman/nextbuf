export const NOTIFICATION_TYPES = [
  "mention",
  "reply",
  "followed_topic_reply",
  "management",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  mention: "提及我",
  reply: "回复我",
  followed_topic_reply: "关注主题有新回复",
  management: "主题管理动态",
};

export type NotificationSnapshot = {
  actorName: string;
  actorUsername: string;
  topicNumber: number;
  topicTitle: string;
  postPosition?: number;
  action?: string;
};

export type NotificationPreferenceView = {
  type: NotificationType;
  label: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
};
