"use client";

import { Heart, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/shadcn/ui/button";

export function PostLikeButton({
  postId,
  initialLiked,
  initialCount,
  canInteract,
  signInHref,
}: {
  postId: string;
  initialLiked: boolean;
  initialCount: number;
  canInteract: boolean;
  signInHref: string;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);

  if (!canInteract) {
    return (
      <Button asChild type="button" variant="ghost" size="sm">
        <Link href={signInHref} aria-label={`登录后点赞，当前 ${count} 个赞`}>
          <Heart /> {count}
        </Link>
      </Button>
    );
  }

  const toggle = async () => {
    setPending(true);
    const response = await fetch(`/api/interactions/posts/${postId}/like`, {
      method: liked ? "DELETE" : "PUT",
    });
    const result = (await response.json().catch(() => ({}))) as {
      active?: boolean;
      count?: number;
    };
    if (response.ok) {
      setLiked(Boolean(result.active));
      if (typeof result.count === "number") setCount(result.count);
    }
    setPending(false);
  };

  return (
    <Button
      type="button"
      variant={liked ? "default" : "ghost"}
      size="sm"
      aria-pressed={liked}
      aria-label={`${liked ? "取消点赞" : "点赞"}，当前 ${count} 个赞`}
      onClick={toggle}
      disabled={pending}
    >
      {pending ? (
        <LoaderCircle className="animate-spin" />
      ) : (
        <Heart fill={liked ? "currentColor" : "none"} />
      )}
      {count}
    </Button>
  );
}
