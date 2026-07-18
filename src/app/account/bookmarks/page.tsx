import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountPageShell } from "@/components/account/account-page-shell";
import { Badge } from "@/components/shadcn/ui/badge";
import { Card, CardContent } from "@/components/shadcn/ui/card";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listBookmarkedTopics } from "@/modules/interactions/queries.server";

export const metadata = { title: "我的收藏" };

export default async function AccountBookmarksPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account/bookmarks");
  const bookmarks = await listBookmarkedTopics(session.user.id);

  return (
    <AccountPageShell
      active="bookmarks"
      description="这里的收藏只对你可见，原主题删除后不会继续暴露内容。"
      title="我的收藏"
    >
      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          {bookmarks.map(({ topic, createdAt }) => (
            <article className="border-b px-5 py-4 last:border-b-0 sm:px-6" key={topic.id}>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Link
                  className="min-w-0 break-words text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  href={`/topics/${topic.number}`}
                >
                  {topic.title}
                </Link>
                {topic.isEssence ? (
                  <Badge variant="secondary" className="rounded-md">
                    精华
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                {topic.node.name} · {topic.author.name} · 收藏于 {createdAt.toLocaleString("zh-CN")}
              </p>
            </article>
          ))}
          {bookmarks.length === 0 ? (
            <div className="grid min-h-56 place-items-center content-center px-5 py-10 text-center text-muted-foreground">
              <p className="text-sm">还没有收藏主题。</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </AccountPageShell>
  );
}
