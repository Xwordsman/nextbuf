import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listAdminTopics } from "@/modules/admin/content.server";
import { AdminError } from "@/modules/admin/errors";

export const metadata = { title: "主题管理" };

export default async function AdminTopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; node?: string; page?: string }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin/content/topics");
  const params = await searchParams;
  const page = params.page && /^\d+$/.test(params.page) ? Number(params.page) : 1;
  let result: Awaited<ReturnType<typeof listAdminTopics>>;
  try {
    result = await listAdminTopics(session.user.id, {
      query: params.q,
      status: params.status,
      node: params.node,
      page,
    });
  } catch (error) {
    if (error instanceof AdminError && error.status === 403) notFound();
    throw error;
  }

  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status) query.set("status", params.status);
  if (params.node) query.set("node", params.node);
  const pageHref = (nextPage: number) => {
    const copy = new URLSearchParams(query);
    copy.set("page", String(nextPage));
    return `/admin/content/topics?${copy}`;
  };

  return (
    <main className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>主题管理</h1>
          <p>按编号、标题、作者、节点和状态筛选主题，处置进入主题详情或治理案件。</p>
        </div>
      </div>
      <Panel className="admin-filter-panel">
        <form action="/admin/content/topics">
          <input name="q" defaultValue={params.q ?? ""} placeholder="主题编号、标题或作者" />
          <select name="status" defaultValue={params.status ?? "all"}>
            <option value="all">全部状态</option>
            <option value="published">已发布</option>
            <option value="closed">已关闭</option>
            <option value="hidden">已隐藏</option>
            <option value="deleted">已删除</option>
            <option value="draft">草稿</option>
          </select>
          <select name="node" defaultValue={params.node ?? ""}>
            <option value="">全部节点</option>
            {result.nodes.map((node) => (
              <option value={node.slug} key={node.id}>
                {node.name}
              </option>
            ))}
          </select>
          <button type="submit">筛选</button>
        </form>
      </Panel>
      <Panel className="admin-section-panel">
        <div className="admin-section-head">
          <h2>主题列表</h2>
          <span>{result.topicCount}</span>
        </div>
        <div className="admin-content-list">
          {result.topics.length === 0 ? (
            <p>没有符合筛选条件的主题。</p>
          ) : (
            result.topics.map((topic) => (
              <article key={topic.id}>
                <div>
                  <Link href={`/topics/${topic.number}`}>
                    #{topic.number} {topic.title}
                  </Link>
                  <span>
                    {topic.node.name} · {topic.author.name} (@{topic.author.username})
                  </span>
                </div>
                <div>
                  <Badge variant="neutral">{topic.status}</Badge>
                  <span>
                    {topic.replyCount} 回复 · {topic.viewCount} 浏览
                  </span>
                  <Link href={`/topics/${topic.number}/edit`}>编辑主题</Link>
                </div>
              </article>
            ))
          )}
        </div>
      </Panel>
      <div className="admin-pagination">
        {page > 1 ? <Link href={pageHref(page - 1)}>上一页</Link> : <span />}
        {page * result.pageSize < result.topicCount ? (
          <Link href={pageHref(page + 1)}>下一页</Link>
        ) : null}
      </div>
    </main>
  );
}
