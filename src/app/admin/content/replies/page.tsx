import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink, Filter, Search } from "lucide-react";
import { AdminPage, AdminPageHeader, AdminPagination } from "@/components/admin/admin-page-layout";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/ui/card";
import { Input } from "@/components/shadcn/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listAdminReplies } from "@/modules/admin/content.server";
import { AdminError } from "@/modules/admin/errors";
import { replyFloorNumber } from "@/shared/community/reply-floor";

export const metadata = { title: "回复管理" };

const replyStatusLabels: Record<string, string> = {
  published: "已发布",
  hidden: "已隐藏",
  deleted: "已删除",
};

export default async function AdminRepliesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; node?: string; page?: string }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin/content/replies");
  const params = await searchParams;
  const page = params.page && /^\d+$/.test(params.page) ? Number(params.page) : 1;
  const node = params.node && params.node !== "all" ? params.node : undefined;
  const status = Object.hasOwn(replyStatusLabels, params.status ?? "") ? params.status : undefined;
  let result: Awaited<ReturnType<typeof listAdminReplies>>;
  try {
    result = await listAdminReplies(session.user.id, {
      query: params.q,
      status: params.status,
      node,
      page,
    });
  } catch (error) {
    if (error instanceof AdminError && error.status === 403) notFound();
    throw error;
  }

  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (status) query.set("status", status);
  if (node) query.set("node", node);
  const pageHref = (nextPage: number) => {
    const copy = new URLSearchParams(query);
    copy.set("page", String(nextPage));
    return `/admin/content/replies?${copy}`;
  };

  return (
    <AdminPage>
      <AdminPageHeader
        description="按主题编号、正文、作者、节点和状态筛选回复，处置进入原主题或治理案件。"
        title="回复管理"
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter aria-hidden="true" className="size-4" />
            筛选回复
          </CardTitle>
          <CardDescription>使用主题、正文、作者与节点快速定位内容。</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action="/admin/content/replies"
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_12rem_auto]"
          >
            <Input
              aria-label="搜索回复"
              defaultValue={params.q ?? ""}
              name="q"
              placeholder="主题编号、回复正文或作者"
            />
            <Select defaultValue={status ?? "all"} name="status">
              <SelectTrigger aria-label="回复状态" className="w-full">
                <SelectValue placeholder="全部状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="published">已发布</SelectItem>
                <SelectItem value="hidden">已隐藏</SelectItem>
                <SelectItem value="deleted">已删除</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue={node ?? "all"} name="node">
              <SelectTrigger aria-label="回复节点" className="w-full">
                <SelectValue placeholder="全部节点" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部节点</SelectItem>
                {result.nodes.map((node) => (
                  <SelectItem key={node.id} value={node.slug}>
                    {node.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit">
              <Search aria-hidden="true" />
              筛选
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>回复列表</CardTitle>
              <CardDescription>按主题楼层显示当前筛选结果。</CardDescription>
            </div>
            <Badge variant="secondary">{result.replyCount}</Badge>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {result.replies.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              没有符合筛选条件的回复。
            </p>
          ) : (
            <div className="divide-y">
              {result.replies.map((reply) => (
                <article
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
                  key={reply.id}
                >
                  <div className="min-w-0 space-y-1.5">
                    <Link
                      className="font-medium hover:underline"
                      href={`/topics/${reply.topic.number}#post-${reply.position}`}
                    >
                      #{reply.topic.number} · {replyFloorNumber(reply.position)} 楼
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {reply.topic.title} · {reply.topic.node.name} · {reply.author.name} (@
                      {reply.author.username})
                    </p>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{reply.bodySource}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    <Badge variant="outline">{replyStatusLabels[reply.status] ?? "未知状态"}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {reply.likeCount} 赞 · {reply.revisionCount} 版
                    </span>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/topics/${reply.topic.number}#post-${reply.position}`}>
                        <ExternalLink aria-hidden="true" />
                        查看
                      </Link>
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AdminPagination
        nextHref={page * result.pageSize < result.replyCount ? pageHref(page + 1) : undefined}
        previousHref={page > 1 ? pageHref(page - 1) : undefined}
      />
    </AdminPage>
  );
}
