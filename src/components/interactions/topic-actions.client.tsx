"use client";

import { Bookmark, LoaderCircle, Rss } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/shadcn/ui/button";

export function TopicActions({
  topicNumber,
  initialBookmarked,
  initialBookmarkCount,
  initialFollowed,
  canInteract,
}: {
  topicNumber: number;
  initialBookmarked: boolean;
  initialBookmarkCount: number;
  initialFollowed: boolean;
  canInteract: boolean;
}) {
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [bookmarkCount, setBookmarkCount] = useState(initialBookmarkCount);
  const [followed, setFollowed] = useState(initialFollowed);
  const [pending, setPending] = useState<"bookmark" | "follow" | null>(null);
  const signInHref = `/auth/sign-in?next=/topics/${topicNumber}`;

  if (!canInteract) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={signInHref}>登录后收藏或关注</Link>
      </Button>
    );
  }

  const toggle = async (kind: "bookmark" | "follow") => {
    const active = kind === "bookmark" ? bookmarked : followed;
    setPending(kind);
    const response = await fetch(`/api/interactions/topics/${topicNumber}/${kind}`, {
      method: active ? "DELETE" : "PUT",
    });
    const result = (await response.json().catch(() => ({}))) as {
      active?: boolean;
      count?: number;
    };
    if (response.ok) {
      if (kind === "bookmark") {
        setBookmarked(Boolean(result.active));
        if (typeof result.count === "number") setBookmarkCount(result.count);
      } else {
        setFollowed(Boolean(result.active));
      }
    }
    setPending(null);
  };

  return (
    <>
      <Button
        type="button"
        variant={bookmarked ? "default" : "outline"}
        size="sm"
        aria-pressed={bookmarked}
        onClick={() => toggle("bookmark")}
        disabled={Boolean(pending)}
      >
        {pending === "bookmark" ? <LoaderCircle className="animate-spin" /> : <Bookmark />}
        {bookmarked ? "已收藏" : "收藏"} {bookmarkCount}
      </Button>
      <Button
        type="button"
        variant={followed ? "default" : "outline"}
        size="sm"
        aria-pressed={followed}
        onClick={() => toggle("follow")}
        disabled={Boolean(pending)}
      >
        {pending === "follow" ? <LoaderCircle className="animate-spin" /> : <Rss />}
        {followed ? "已关注" : "关注主题"}
      </Button>
    </>
  );
}
