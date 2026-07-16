import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NotificationList } from "@/components/notifications/notification-list.client";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listNotifications } from "@/modules/notifications/notifications.server";

export const metadata = { title: "通知中心" };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/notifications");
  const unreadOnly = (await searchParams).filter === "unread";
  const items = await listNotifications(session.user.id, unreadOnly);
  return (
    <main className="notifications-page">
      <div className="account-page-head notifications-page-head">
        <div>
          <h1>通知中心</h1>
          <p>回复、提及、关注主题和管理动态。</p>
        </div>
        <Link href="/account/notifications">通知偏好</Link>
      </div>
      <nav className="notification-filter" aria-label="通知筛选">
        <Link href="/notifications" aria-current={!unreadOnly ? "page" : undefined}>
          全部
        </Link>
        <Link href="/notifications?filter=unread" aria-current={unreadOnly ? "page" : undefined}>
          未读
        </Link>
      </nav>
      <Panel className="notifications-panel">
        <NotificationList
          initialItems={items.map((item) => ({
            id: item.id,
            type: item.type,
            snapshot: item.snapshot,
            readAt: item.readAt?.toISOString() ?? null,
            createdAt: item.createdAt.toISOString(),
            actor: item.actor,
          }))}
        />
      </Panel>
    </main>
  );
}
