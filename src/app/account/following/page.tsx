import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/account/account-nav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listFollowedTopics, listFollowedUsers } from "@/modules/interactions/queries.server";

export const metadata = { title: "我的关注" };

export default async function AccountFollowingPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account/following");
  const [users, topics] = await Promise.all([
    listFollowedUsers(session.user.id),
    listFollowedTopics(session.user.id),
  ]);
  return (
    <main className="account-page">
      <div className="account-page-head">
        <h1>我的关注</h1>
        <p>查看你主动关注的成员和主题。通知功能将在后续里程碑接入。</p>
      </div>
      <AccountNav active="following" />
      <section className="account-section" aria-labelledby="followed-members-title">
        <h2 id="followed-members-title">成员</h2>
        <Panel className="account-follow-list">
          {users.map(({ followed, createdAt }) => (
            <article key={followed.id}>
              <Avatar className="size-10">
                <AvatarImage src={followed.image ?? undefined} alt={followed.name} />
                <AvatarFallback>{followed.name.trim().slice(0, 1) || "U"}</AvatarFallback>
              </Avatar>
              <div>
                <Link href={`/u/${followed.username}`}>{followed.name}</Link>
                <p>
                  @{followed.username} · 关注于 {createdAt.toLocaleDateString("zh-CN")}
                </p>
              </div>
            </article>
          ))}
          {users.length === 0 ? (
            <div className="account-topic-empty">
              <p>还没有关注成员。</p>
            </div>
          ) : null}
        </Panel>
      </section>
      <section className="account-section" aria-labelledby="followed-topics-title">
        <h2 id="followed-topics-title">主题</h2>
        <Panel className="account-topic-list">
          {topics.map(({ topic, createdAt }) => (
            <article key={topic.id}>
              <div>
                <div className="account-topic-title">
                  <Link href={`/topics/${topic.number}`}>{topic.title}</Link>
                </div>
                <p>
                  {topic.node.name} · {topic.author.name} · 关注于{" "}
                  {createdAt.toLocaleString("zh-CN")}
                </p>
              </div>
            </article>
          ))}
          {topics.length === 0 ? (
            <div className="account-topic-empty">
              <p>还没有关注主题。</p>
            </div>
          ) : null}
        </Panel>
      </section>
    </main>
  );
}
