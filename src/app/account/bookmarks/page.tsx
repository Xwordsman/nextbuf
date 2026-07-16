import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/account/account-nav";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listBookmarkedTopics } from "@/modules/interactions/queries.server";

export const metadata = { title: "我的收藏" };

export default async function AccountBookmarksPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account/bookmarks");
  const bookmarks = await listBookmarkedTopics(session.user.id);
  return (
    <main className="account-page">
      <div className="account-page-head">
        <h1>我的收藏</h1>
        <p>这里的收藏只对你可见，原主题删除后不会继续暴露内容。</p>
      </div>
      <AccountNav active="bookmarks" />
      <Panel className="account-topic-list">
        {bookmarks.map(({ topic, createdAt }) => (
          <article key={topic.id}>
            <div>
              <div className="account-topic-title">
                <Link href={`/topics/${topic.number}`}>{topic.title}</Link>
                {topic.isEssence ? <Badge variant="essence">精华</Badge> : null}
              </div>
              <p>
                {topic.node.name} · {topic.author.name} · 收藏于 {createdAt.toLocaleString("zh-CN")}
              </p>
            </div>
          </article>
        ))}
        {bookmarks.length === 0 ? (
          <div className="account-topic-empty">
            <p>还没有收藏主题。</p>
          </div>
        ) : null}
      </Panel>
    </main>
  );
}
