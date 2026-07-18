import { headers } from "next/headers";
import Link from "next/link";
import { FilePenLine, Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { AccountPageShell } from "@/components/account/account-page-shell";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardContent } from "@/components/shadcn/ui/card";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listUserTopics } from "@/modules/community/queries.server";

export const metadata = { title: "我的主题" };

const labels: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  closed: "已关闭",
  hidden: "已隐藏",
  deleted: "已删除",
};

export default async function AccountTopicsPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account/topics");
  const topics = await listUserTopics(session.user.id);

  return (
    <AccountPageShell
      active="topics"
      description="管理草稿、已发布主题和可恢复的软删除记录。"
      title="我的主题"
      action={
        <Button asChild>
          <Link href="/topics/new">
            <Plus data-icon="inline-start" aria-hidden="true" /> 发布主题
          </Link>
        </Button>
      }
    >
      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          {topics.map((topic) => (
            <article
              className="flex min-h-20 flex-col justify-between gap-3 border-b px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:px-6"
              key={topic.id}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link
                    className="min-w-0 break-words text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    href={`/topics/${topic.number}`}
                  >
                    {topic.title}
                  </Link>
                  <Badge
                    variant={topic.status === "published" ? "outline" : "secondary"}
                    className="rounded-md"
                  >
                    {labels[topic.status] ?? topic.status}
                  </Badge>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  {topic.node.name} · 更新于 {topic.updatedAt.toLocaleString("zh-CN")}
                </p>
              </div>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="shrink-0 self-start sm:self-auto"
              >
                <Link href={`/topics/${topic.number}/edit`}>
                  <FilePenLine data-icon="inline-start" aria-hidden="true" /> 编辑
                </Link>
              </Button>
            </article>
          ))}
          {topics.length === 0 ? (
            <div className="grid min-h-56 place-items-center content-center gap-3 px-5 py-10 text-center text-muted-foreground">
              <p className="text-sm">还没有主题或草稿。</p>
              <Button asChild variant="outline" size="sm">
                <Link href="/topics/new">发布第一个主题</Link>
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </AccountPageShell>
  );
}
