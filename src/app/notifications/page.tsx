import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NotificationList } from "@/components/notifications/notification-list.client";
import { Button } from "@/components/shadcn/ui/button";
import { Card } from "@/components/shadcn/ui/card";
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
    <main className="mx-auto w-full max-w-[980px] px-4 py-8 sm:px-6 lg:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1.5">
          <h1 className="font-heading text-2xl font-semibold tracking-normal text-foreground">
            通知中心
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            回复、提及、关注主题和管理动态。
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/account/notifications">通知偏好</Link>
        </Button>
      </header>

      <nav className="mb-4 flex flex-wrap gap-1" aria-label="通知筛选">
        <Button asChild size="sm" variant={!unreadOnly ? "secondary" : "ghost"}>
          <Link href="/notifications" aria-current={!unreadOnly ? "page" : undefined}>
            全部
          </Link>
        </Button>
        <Button asChild size="sm" variant={unreadOnly ? "secondary" : "ghost"}>
          <Link href="/notifications?filter=unread" aria-current={unreadOnly ? "page" : undefined}>
            未读
          </Link>
        </Button>
      </nav>

      <Card className="gap-0 py-0">
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
      </Card>
    </main>
  );
}
