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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { resolvePublicProfile } from "@/modules/profiles/profile.server";
import { getUserFollowSummary } from "@/modules/interactions/queries.server";
import { getCurrentUserId } from "@/modules/identity/session.server";

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
    <main className="profile-page">
      <header className="profile-hero">
        <Avatar className="profile-avatar">
          <AvatarImage src={user.image ?? undefined} alt={user.name} />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="profile-identity">
          <div className="profile-name-line">
            <h1>{user.name}</h1>
            <span>@{user.username}</span>
          </div>
          <div className="profile-uid-line">
            <span>UID {user.uid}</span>
            <Badge variant="trust">TL0</Badge>
          </div>
        </div>
        <div className="profile-follow-action">
          <UserFollowButton
            username={user.username}
            initialFollowed={follow.followedByViewer}
            canFollow={follow.canFollow}
            signedIn={Boolean(viewerId)}
          />
        </div>
      </header>
      {profile?.isPublic === false ? (
        <Panel className="profile-private">
          <h2>该用户未公开个人资料</h2>
          <p>基本身份信息仍用于社区内容归属。</p>
        </Panel>
      ) : (
        <div className="profile-layout">
          <section className="profile-main">
            <Panel className="profile-about">
              <h2>关于</h2>
              <p>{profile?.bio || "这个用户还没有填写简介。"}</p>
              {profile?.website ? (
                <Link href={profile.website} target="_blank" rel="noreferrer">
                  <ExternalLink /> {new URL(profile.website).hostname}
                </Link>
              ) : null}
            </Panel>
            {profile?.showActivity !== false ? (
              <div className="profile-stats">
                <Panel>
                  <MessageSquareText />
                  <strong>{user._count.communityTopics}</strong>
                  <span>主题</span>
                </Panel>
                <Panel>
                  <MessagesSquare />
                  <strong>{user._count.communityPosts}</strong>
                  <span>回复</span>
                </Panel>
                <Panel>
                  <UsersRound />
                  <strong>{follow.followers}</strong>
                  <span>关注者</span>
                </Panel>
                <Panel>
                  <UserRoundCheck />
                  <strong>{follow.following}</strong>
                  <span>正在关注</span>
                </Panel>
              </div>
            ) : null}
          </section>
          <aside>
            <Panel className="profile-meta">
              <h2>账号信息</h2>
              <p>
                <CalendarDays /> 加入于 {user.createdAt.toLocaleDateString("zh-CN")}
              </p>
              <p>邮箱已验证：{user.emailVerified ? "是" : "否"}</p>
            </Panel>
          </aside>
        </div>
      )}
    </main>
  );
}
