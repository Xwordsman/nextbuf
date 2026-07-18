import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountPageShell } from "@/components/account/account-page-shell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shadcn/ui/card";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listFollowedTopics, listFollowedUsers } from "@/modules/interactions/queries.server";

export const metadata = { title: "我的关注" };

export default async function AccountFollowingPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account/following");
  const [users, topics] = await Promise.all([
    listFollowedUsers(session.user.id),
    listFollowedTopics(session.user.id),
  ]);

  return (
    <AccountPageShell
      active="following"
      description="查看你主动关注的成员和主题。"
      title="我的关注"
    >
      <div className="grid gap-5">
        <section aria-labelledby="followed-members-title">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle>
                <h2 id="followed-members-title">成员</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {users.map(({ followed, createdAt }) => (
                <article
                  className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-3 border-b px-5 py-4 last:border-b-0 sm:px-6"
                  key={followed.id}
                >
                  <Avatar size="lg">
                    <AvatarImage src={followed.image ?? undefined} alt={followed.name} />
                    <AvatarFallback>{followed.name.trim().slice(0, 1) || "U"}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <Link
                      className="block truncate text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      href={`/u/${followed.username}`}
                    >
                      {followed.name}
                    </Link>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      @{followed.username} · 关注于 {createdAt.toLocaleDateString("zh-CN")}
                    </p>
                  </div>
                </article>
              ))}
              {users.length === 0 ? (
                <div className="grid min-h-44 place-items-center content-center px-5 py-8 text-center text-muted-foreground">
                  <p className="text-sm">还没有关注成员。</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="followed-topics-title">
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle>
                <h2 id="followed-topics-title">主题</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {topics.map(({ topic, createdAt }) => (
                <article className="border-b px-5 py-4 last:border-b-0 sm:px-6" key={topic.id}>
                  <div className="min-w-0">
                    <Link
                      className="break-words text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      href={`/topics/${topic.number}`}
                    >
                      {topic.title}
                    </Link>
                    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                      {topic.node.name} · {topic.author.name} · 关注于{" "}
                      {createdAt.toLocaleString("zh-CN")}
                    </p>
                  </div>
                </article>
              ))}
              {topics.length === 0 ? (
                <div className="grid min-h-44 place-items-center content-center px-5 py-8 text-center text-muted-foreground">
                  <p className="text-sm">还没有关注主题。</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>
      </div>
    </AccountPageShell>
  );
}
