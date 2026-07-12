import { headers } from "next/headers";
import Link from "next/link";
import { FilePenLine, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/account/account-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listUserTopics } from "@/modules/community/queries.server";

export const metadata = { title: "我的主题" };

export default async function AccountTopicsPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account/topics");
  const topics = await listUserTopics(session.user.id);
  const labels: Record<string, string> = {
    draft: "草稿",
    published: "已发布",
    closed: "已关闭",
    hidden: "已隐藏",
    deleted: "已删除",
  };
  return (
    <main className="account-page">
      <div className="account-page-head account-page-head-row">
        <div>
          <h1>我的主题</h1>
          <p>管理草稿、已发布主题和可恢复的软删除记录。</p>
        </div>
        <Button asChild>
          <Link href="/topics/new">
            <Plus /> 发布主题
          </Link>
        </Button>
      </div>
      <AccountNav active="topics" />
      <Panel className="account-topic-list">
        {topics.map((topic) => (
          <article key={topic.id}>
            <div>
              <div className="account-topic-title">
                <Link href={`/topics/${topic.number}`}>{topic.title}</Link>
                <Badge>{labels[topic.status] ?? topic.status}</Badge>
              </div>
              <p>
                {topic.node.name} · 更新于 {topic.updatedAt.toLocaleString("zh-CN")}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href={`/topics/${topic.number}/edit`}>
                <FilePenLine /> 编辑
              </Link>
            </Button>
          </article>
        ))}
        {topics.length === 0 ? (
          <div className="account-topic-empty">
            <p>还没有主题或草稿。</p>
            <Link href="/topics/new">发布第一个主题</Link>
          </div>
        ) : null}
      </Panel>
    </main>
  );
}
