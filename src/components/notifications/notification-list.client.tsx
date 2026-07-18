"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Check, CheckCheck, Inbox } from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import type { NotificationSnapshot, NotificationType } from "@/modules/notifications/contracts";

type Item = {
  id: string;
  type: NotificationType;
  snapshot: NotificationSnapshot;
  readAt: string | null;
  createdAt: string;
  actor: { name: string; username: string; image: string | null } | null;
};

function summary(item: Item): string {
  switch (item.type) {
    case "mention":
      return `${item.snapshot.actorName} 在回复中提及了你`;
    case "reply":
      return `${item.snapshot.actorName} 回复了你参与的主题`;
    case "followed_topic_reply":
      return `${item.snapshot.actorName} 在你关注的主题中发布了回复`;
    case "management":
      return `${item.snapshot.actorName} 更新了你的主题状态`;
  }
}

export function NotificationList({ initialItems }: { initialItems: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [busy, setBusy] = useState<string | null>(null);

  const mutate = async (id: string, action: "read" | "archive") => {
    setBusy(id);
    const response = await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (response.ok) {
      setItems((current) =>
        action === "archive"
          ? current.filter((item) => item.id !== id)
          : current.map((item) =>
              item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
            ),
      );
      router.refresh();
    }
    setBusy(null);
  };

  const markAll = async () => {
    setBusy("all");
    const response = await fetch("/api/notifications/read-all", { method: "POST" });
    if (response.ok) {
      const now = new Date().toISOString();
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })));
      router.refresh();
    }
    setBusy(null);
  };

  const unreadCount = items.filter((item) => !item.readAt).length;

  return (
    <>
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3 sm:px-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>未读通知</span>
          <Badge
            variant={unreadCount > 0 ? "secondary" : "outline"}
            className="rounded-md tabular-nums"
            data-testid="unread-notification-count"
          >
            {unreadCount}
          </Badge>
        </div>
        <Button type="button" variant="outline" onClick={markAll} disabled={busy !== null}>
          <CheckCheck aria-hidden="true" /> 全部已读
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="grid min-h-64 place-items-center content-center gap-2 px-5 py-10 text-center text-muted-foreground">
          <Inbox className="size-7" aria-hidden="true" />
          <p className="text-sm">这里暂时没有通知。</p>
        </div>
      ) : (
        <div>
          {items.map((item) => {
            const href = `/topics/${item.snapshot.topicNumber}${item.snapshot.postPosition ? `#post-${item.snapshot.postPosition}` : ""}`;
            return (
              <article
                className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-3 border-b px-5 py-4 last:border-b-0 data-[unread=true]:bg-muted/40 max-sm:grid-cols-[36px_minmax(0,1fr)] max-sm:px-4"
                data-testid="notification-item"
                data-unread={!item.readAt}
                key={item.id}
              >
                <Avatar size="lg" className="max-sm:size-9">
                  <AvatarImage
                    src={item.actor?.image ?? undefined}
                    alt={item.actor?.name ?? "系统"}
                  />
                  <AvatarFallback>
                    {item.snapshot.actorName.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 gap-1">
                  <p className="text-sm leading-5 text-foreground">{summary(item)}</p>
                  <Link
                    className="w-fit max-w-full truncate text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    href={href}
                    onClick={(event) => {
                      if (!item.readAt) {
                        event.preventDefault();
                        void mutate(item.id, "read").then(() => router.push(href));
                      }
                    }}
                  >
                    {item.snapshot.topicTitle}
                  </Link>
                  <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString("zh-CN")}
                  </time>
                </div>
                <div className="flex items-center gap-1 max-sm:col-start-2 max-sm:justify-end">
                  {!item.readAt ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="标记已读"
                      aria-label="标记已读"
                      disabled={busy !== null}
                      onClick={() => void mutate(item.id, "read")}
                    >
                      <Check aria-hidden="true" />
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="归档"
                    aria-label="归档"
                    disabled={busy !== null}
                    onClick={() => void mutate(item.id, "archive")}
                  >
                    <Archive aria-hidden="true" />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
