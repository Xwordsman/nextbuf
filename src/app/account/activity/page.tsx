import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/account/account-nav";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listParticipatedTopics } from "@/modules/interactions/queries.server";

export const metadata = { title: "我的参与" };

export default async function AccountActivityPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account/activity");
  const topics = await listParticipatedTopics(session.user.id);
  return (
    <main className="account-page">
      <div className="account-page-head">
        <h1>我的参与</h1>
        <p>按最近活动查看你发布或回复过的公开主题。</p>
      </div>
      <AccountNav active="activity" />
      <Panel className="account-topic-list">
        {topics.map((topic) => (
          <article key={topic.id}>
            <div>
              <div className="account-topic-title">
                <Link href={`/topics/${topic.number}`}>{topic.title}</Link>
              </div>
              <p>
                {topic.node.name} · {topic.replyCount} 条回复 · 最近活动{" "}
                {topic.lastActivityAt.toLocaleString("zh-CN")}
              </p>
            </div>
          </article>
        ))}
        {topics.length === 0 ? (
          <div className="account-topic-empty">
            <p>还没有参与公开主题。</p>
          </div>
        ) : null}
      </Panel>
    </main>
  );
}
