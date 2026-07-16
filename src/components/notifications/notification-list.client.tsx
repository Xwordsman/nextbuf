"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Check, CheckCheck, Inbox } from "lucide-react";
import { useState } from "react";
import type { NotificationSnapshot, NotificationType } from "@/modules/notifications/contracts";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

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

  return (
    <>
      <div className="notification-page-toolbar">
        <span>{items.filter((item) => !item.readAt).length} 条未读</span>
        <Button type="button" variant="outline" onClick={markAll} disabled={busy !== null}>
          <CheckCheck /> 全部已读
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="notification-page-empty">
          <Inbox />
          <p>这里暂时没有通知。</p>
        </div>
      ) : (
        <div className="notification-page-list">
          {items.map((item) => {
            const href = `/topics/${item.snapshot.topicNumber}${item.snapshot.postPosition ? `#post-${item.snapshot.postPosition}` : ""}`;
            return (
              <article className="notification-page-item" data-unread={!item.readAt} key={item.id}>
                <Avatar className="size-10">
                  <AvatarImage
                    src={item.actor?.image ?? undefined}
                    alt={item.actor?.name ?? "系统"}
                  />
                  <AvatarFallback>
                    {item.snapshot.actorName.slice(0, 1).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="notification-page-copy">
                  <p>{summary(item)}</p>
                  <Link
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
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString("zh-CN")}
                  </time>
                </div>
                <div className="notification-page-actions">
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
                      <Check />
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
                    <Archive />
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
