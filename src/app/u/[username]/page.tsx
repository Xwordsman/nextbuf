import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarDays,
  ExternalLink,
  MessageSquareText,
  MessagesSquare,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { UserFollowButton } from "@/components/interactions/user-follow-button.client";
import { ReportDialog } from "@/components/moderation/report-dialog.client";
import { Alert, AlertDescription, AlertTitle } from "@/components/shadcn/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar";
import { Badge } from "@/components/shadcn/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shadcn/ui/card";
import { getUserFollowSummary } from "@/modules/interactions/queries.server";
import { getCurrentUserId } from "@/modules/identity/session.server";
import { resolvePublicProfile } from "@/modules/profiles/profile.server";

type UserPageProps = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: UserPageProps): Promise<Metadata> {
  const result = await resolvePublicProfile((await params).username);
  return result
    ? { title: `${result.user.name} (@${result.user.username})` }
    : { title: "用户不存在" };
}

export default async function UserPage({ params }: UserPageProps) {
  const handle = (await params).username.toLowerCase();
  const result = await resolvePublicProfile(handle);
  if (!result) notFound();
  if (result.redirected) redirect(`/u/${result.user.username}`);
  const { user } = result;
  const profile = user.profile;
  const initials = user.name.trim().slice(0, 1).toLocaleUpperCase("zh-CN") || "U";
  const viewerId = await getCurrentUserId();
  const follow = await getUserFollowSummary(viewerId, user.id);

  return (
    <main className="mx-auto w-full max-w-[980px] px-4 py-8 sm:px-6 lg:py-10">
      <Card className="mb-5">
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar size="lg" className="size-20">
            <AvatarImage src={user.image ?? undefined} alt={user.name} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 gap-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <h1 className="min-w-0 break-words text-2xl font-semibold tracking-normal text-foreground">
                {user.name}
              </h1>
              <span className="text-sm text-muted-foreground">@{user.username}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">UID {user.uid}</span>
              <Badge variant="secondary" className="rounded-md">
                TL{user.trustState?.currentLevel ?? 0}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <UserFollowButton
              username={user.username}
              initialFollowed={follow.followedByViewer}
              canFollow={follow.canFollow}
              signedIn={Boolean(viewerId)}
            />
            {viewerId !== user.id ? (
              <ReportDialog
                target={{ type: "user", username: user.username }}
                signedIn={Boolean(viewerId)}
                signInHref={`/auth/sign-in?next=/u/${user.username}`}
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      {profile?.isPublic === false ? (
        <Alert>
          <UserRoundCheck aria-hidden="true" />
          <AlertTitle>该用户未公开个人资料</AlertTitle>
          <AlertDescription>基本身份信息仍用于社区内容归属。</AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="grid gap-5" aria-labelledby="profile-about-title">
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 id="profile-about-title">关于</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p className="text-sm leading-7 text-muted-foreground">
                  {profile?.bio || "这个用户还没有填写简介。"}
                </p>
                {profile?.website ? (
                  <Link
                    className="flex w-fit max-w-full items-center gap-1.5 truncate text-sm text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    href={profile.website}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
                    {new URL(profile.website).hostname}
                  </Link>
                ) : null}
              </CardContent>
            </Card>

            {profile?.showActivity !== false ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="活动统计">
                <Card size="sm" className="gap-0 py-0" role="group" aria-label="主题">
                  <CardContent className="grid gap-1 p-4">
                    <MessageSquareText
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <p className="text-xl font-semibold tabular-nums text-foreground">
                      {user._count.communityTopics}
                    </p>
                    <span className="text-xs text-muted-foreground">主题</span>
                  </CardContent>
                </Card>
                <Card size="sm" className="gap-0 py-0" role="group" aria-label="回复">
                  <CardContent className="grid gap-1 p-4">
                    <MessagesSquare className="size-4 text-muted-foreground" aria-hidden="true" />
                    <p className="text-xl font-semibold tabular-nums text-foreground">
                      {user._count.communityPosts}
                    </p>
                    <span className="text-xs text-muted-foreground">回复</span>
                  </CardContent>
                </Card>
                <Card size="sm" className="gap-0 py-0" role="group" aria-label="关注者">
                  <CardContent className="grid gap-1 p-4">
                    <UsersRound className="size-4 text-muted-foreground" aria-hidden="true" />
                    <p className="text-xl font-semibold tabular-nums text-foreground">
                      {follow.followers}
                    </p>
                    <span className="text-xs text-muted-foreground">关注者</span>
                  </CardContent>
                </Card>
                <Card size="sm" className="gap-0 py-0" role="group" aria-label="正在关注">
                  <CardContent className="grid gap-1 p-4">
                    <UserRoundCheck className="size-4 text-muted-foreground" aria-hidden="true" />
                    <p className="text-xl font-semibold tabular-nums text-foreground">
                      {follow.following}
                    </p>
                    <span className="text-xs text-muted-foreground">正在关注</span>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </section>

          <aside>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>账号信息</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <CalendarDays className="size-4 shrink-0" aria-hidden="true" /> 加入于{" "}
                  {user.createdAt.toLocaleDateString("zh-CN")}
                </p>
                <p>邮箱已验证：{user.emailVerified ? "是" : "否"}</p>
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </main>
  );
}
