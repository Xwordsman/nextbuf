import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listAdminReplies } from "@/modules/admin/content.server";
import { AdminError } from "@/modules/admin/errors";

export const metadata = { title: "回复管理" };

export default async function AdminRepliesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; node?: string; page?: string }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin/content/replies");
  const params = await searchParams;
  const page = params.page && /^\d+$/.test(params.page) ? Number(params.page) : 1;
  let result: Awaited<ReturnType<typeof listAdminReplies>>;
  try {
    result = await listAdminReplies(session.user.id, {
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
    return `/admin/content/replies?${copy}`;
  };

  return (
    <main className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>回复管理</h1>
          <p>按主题编号、正文、作者、节点和状态筛选回复，处置进入原主题或治理案件。</p>
        </div>
      </div>
      <Panel className="admin-filter-panel">
        <form action="/admin/content/replies">
          <input name="q" defaultValue={params.q ?? ""} placeholder="主题编号、回复正文或作者" />
          <select name="status" defaultValue={params.status ?? "all"}>
            <option value="all">全部状态</option>
            <option value="published">已发布</option>
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
          <h2>回复列表</h2>
          <span>{result.replyCount}</span>
        </div>
        <div className="admin-content-list">
          {result.replies.length === 0 ? (
            <p>没有符合筛选条件的回复。</p>
          ) : (
            result.replies.map((reply) => (
              <article key={reply.id}>
                <div>
                  <Link href={`/topics/${reply.topic.number}#post-${reply.position}`}>
                    #{reply.topic.number} · {reply.position} 楼
                  </Link>
                  <span>
                    {reply.topic.title} · {reply.topic.node.name} · {reply.author.name} (@
                    {reply.author.username})
                  </span>
                  <p>{reply.bodySource.slice(0, 180)}</p>
                </div>
                <div>
                  <Badge variant="neutral">{reply.status}</Badge>
                  <span>
                    {reply.likeCount} 赞 · {reply.revisionCount} 版
                  </span>
                  <Link href={`/topics/${reply.topic.number}#post-${reply.position}`}>
                    查看回复
                  </Link>
                </div>
              </article>
            ))
          )}
        </div>
      </Panel>
      <div className="admin-pagination">
        {page > 1 ? <Link href={pageHref(page - 1)}>上一页</Link> : <span />}
        {page * result.pageSize < result.replyCount ? (
          <Link href={pageHref(page + 1)}>下一页</Link>
        ) : null}
      </div>
    </main>
  );
}
