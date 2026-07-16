import type { NotificationSnapshot, NotificationType } from "@/modules/notifications/contracts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function message(type: NotificationType, snapshot: NotificationSnapshot): string {
  switch (type) {
    case "mention":
      return `${snapshot.actorName} 在主题中提及了你`;
    case "reply":
      return `${snapshot.actorName} 回复了你参与的主题`;
    case "followed_topic_reply":
      return `${snapshot.actorName} 在你关注的主题中发布了新回复`;
    case "management":
      return `${snapshot.actorName} 更新了你的主题状态`;
  }
}

export function renderNotificationMail(
  type: NotificationType,
  snapshot: NotificationSnapshot,
  appUrl: string,
) {
  const summary = message(type, snapshot);
  const topicUrl = new URL(
    `/topics/${snapshot.topicNumber}${snapshot.postPosition ? `#post-${snapshot.postPosition}` : ""}`,
    appUrl,
  ).toString();
  const subject = `${summary}：${snapshot.topicTitle}`.slice(0, 255);
  return {
    subject,
    text: `${summary}\n\n${snapshot.topicTitle}\n${topicUrl}\n\n你可以在 NextBuf 的通知偏好中关闭普通通知邮件。`,
    html: `<p>${escapeHtml(summary)}</p><p><a href="${escapeHtml(topicUrl)}">${escapeHtml(snapshot.topicTitle)}</a></p><p>你可以在 NextBuf 的通知偏好中关闭普通通知邮件。</p>`,
  };
}
