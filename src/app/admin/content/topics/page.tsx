import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Filter, Pencil, Search } from "lucide-react";
import { AdminPage, AdminPageHeader, AdminPagination } from "@/components/admin/admin-page-layout";
import { Badge } from "@/components/admin/ui/badge";
import { Button } from "@/components/admin/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/ui/card";
import { Input } from "@/components/admin/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/admin/ui/select";
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
  const node = params.node && params.node !== "all" ? params.node : undefined;
  let result: Awaited<ReturnType<typeof listAdminTopics>>;
  try {
    result = await listAdminTopics(session.user.id, {
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
  if (params.status) query.set("status", params.status);
  if (node) query.set("node", node);
  const pageHref = (nextPage: number) => {
    const copy = new URLSearchParams(query);
    copy.set("page", String(nextPage));
    return `/admin/content/topics?${copy}`;
  };

  return (
    <AdminPage>
      <AdminPageHeader
        description="按编号、标题、作者、节点和状态筛选主题，处置进入主题详情或治理案件。"
        title="主题管理"
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter aria-hidden="true" className="size-4" />
            筛选主题
          </CardTitle>
          <CardDescription>筛选条件通过地址栏保留，便于复制或返回。</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action="/admin/content/topics"
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_12rem_auto]"
          >
            <Input
              aria-label="搜索主题"
              defaultValue={params.q ?? ""}
              name="q"
              placeholder="主题编号、标题或作者"
            />
            <Select defaultValue={params.status ?? "all"} name="status">
              <SelectTrigger aria-label="主题状态" className="w-full">
                <SelectValue placeholder="全部状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="published">已发布</SelectItem>
                <SelectItem value="closed">已关闭</SelectItem>
                <SelectItem value="hidden">已隐藏</SelectItem>
                <SelectItem value="deleted">已删除</SelectItem>
                <SelectItem value="draft">草稿</SelectItem>
              </SelectContent>
            </Select>
            <Select defaultValue={node ?? "all"} name="node">
              <SelectTrigger aria-label="主题节点" className="w-full">
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
              <CardTitle>主题列表</CardTitle>
              <CardDescription>显示当前筛选条件下的主题。</CardDescription>
            </div>
            <Badge variant="secondary">{result.topicCount}</Badge>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {result.topics.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              没有符合筛选条件的主题。
            </p>
          ) : (
            <div className="divide-y">
              {result.topics.map((topic) => (
                <article
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
                  key={topic.id}
                >
                  <div className="min-w-0 space-y-1">
                    <Link className="font-medium hover:underline" href={`/topics/${topic.number}`}>
                      #{topic.number} {topic.title}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {topic.node.name} · {topic.author.name} (@{topic.author.username})
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    <Badge variant="outline">{topic.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {topic.replyCount} 回复 · {topic.viewCount} 浏览
                    </span>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/topics/${topic.number}/edit`}>
                        <Pencil aria-hidden="true" />
                        编辑
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
        nextHref={page * result.pageSize < result.topicCount ? pageHref(page + 1) : undefined}
        previousHref={page > 1 ? pageHref(page - 1) : undefined}
      />
    </AdminPage>
  );
}
