import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountPageShell } from "@/components/account/account-page-shell";
import { Card, CardContent } from "@/components/shadcn/ui/card";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listParticipatedTopics } from "@/modules/interactions/queries.server";

export const metadata = { title: "我的参与" };

export default async function AccountActivityPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account/activity");
  const topics = await listParticipatedTopics(session.user.id);

  return (
    <AccountPageShell
      active="activity"
      description="按最近活动查看你发布或回复过的公开主题。"
      title="我的参与"
    >
      <Card className="gap-0 py-0">
        <CardContent className="p-0">
          {topics.map((topic) => (
            <article className="border-b px-5 py-4 last:border-b-0 sm:px-6" key={topic.id}>
              <div className="min-w-0">
                <Link
                  className="break-words text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  href={`/topics/${topic.number}`}
                >
                  {topic.title}
                </Link>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  {topic.node.name} · {topic.replyCount} 条回复 · 最近活动于{" "}
                  {topic.lastActivityAt.toLocaleString("zh-CN")}
                </p>
              </div>
            </article>
          ))}
          {topics.length === 0 ? (
            <div className="grid min-h-56 place-items-center content-center px-5 py-10 text-center text-muted-foreground">
              <p className="text-sm">还没有参与公开主题。</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </AccountPageShell>
  );
}
