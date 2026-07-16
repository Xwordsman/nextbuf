"use client";

import { LoaderCircle, UserPlus, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function UserFollowButton({
  username,
  initialFollowed,
  canFollow,
  signedIn,
}: {
  username: string;
  initialFollowed: boolean;
  canFollow: boolean;
  signedIn: boolean;
}) {
  const [followed, setFollowed] = useState(initialFollowed);
  const [pending, setPending] = useState(false);
  if (!signedIn) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/auth/sign-in?next=/u/${username}`}>
          <UserPlus /> 关注
        </Link>
      </Button>
    );
  }
  if (!canFollow) return null;

  const toggle = async () => {
    setPending(true);
    const response = await fetch(`/api/interactions/users/${username}/follow`, {
      method: followed ? "DELETE" : "PUT",
    });
    const result = (await response.json().catch(() => ({}))) as { active?: boolean };
    if (response.ok) setFollowed(Boolean(result.active));
    setPending(false);
  };

  return (
    <Button
      type="button"
      variant={followed ? "default" : "outline"}
      size="sm"
      aria-pressed={followed}
      onClick={toggle}
      disabled={pending}
    >
      {pending ? (
        <LoaderCircle className="animate-spin" />
      ) : followed ? (
        <UserRoundCheck />
      ) : (
        <UserPlus />
      )}
      {followed ? "已关注" : "关注"}
    </Button>
  );
}
