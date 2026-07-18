import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Gavel } from "lucide-react";
import { AdminPage, AdminPageHeader } from "@/components/admin/admin-page-layout";
import { Badge } from "@/components/admin/ui/badge";
import { Button } from "@/components/admin/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/ui/card";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { ModerationError } from "@/modules/moderation/errors";
import { listModerationCases } from "@/modules/moderation/queries.server";

export const metadata = { title: "治理案件" };

export default async function ModerationCasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin/moderation");
  const requestedStatus = (await searchParams).status ?? "open";
  const status = ["open", "in_review", "resolved", "dismissed", "all"].includes(requestedStatus)
    ? requestedStatus
    : "open";
  let cases;
  try {
    cases = await listModerationCases(session.user.id, status);
  } catch (error) {
    if (error instanceof ModerationError && error.status === 403) notFound();
    throw error;
  }

  const filters = [
    ["open", "待处理"],
    ["in_review", "处理中"],
    ["resolved", "已结案"],
    ["dismissed", "已驳回"],
    ["all", "全部"],
  ] as const;

  return (
    <AdminPage>
      <AdminPageHeader
        description="举报按目标聚合；处置、制裁和结案均保留不可变审计记录。"
        title="治理案件"
      />
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Gavel aria-hidden="true" className="size-4" />
            案件队列
          </CardTitle>
          <CardDescription>按当前处理状态筛选案件。</CardDescription>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <nav aria-label="案件状态" className="flex gap-1 overflow-x-auto border-b px-4 py-3">
            {filters.map(([value, label]) => (
              <Button
                asChild
                key={value}
                size="sm"
                variant={status === value ? "secondary" : "ghost"}
              >
                <Link
                  href={`/admin/moderation?status=${value}`}
                  aria-current={status === value ? "page" : undefined}
                >
                  {label}
                </Link>
              </Button>
            ))}
          </nav>
          {cases.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              当前筛选下没有案件。
            </p>
          ) : (
            <div className="divide-y">
              {cases.map((item) => (
                <Link
                  className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                  href={`/admin/moderation/${item.number}`}
                  key={item.id}
                >
                  <div className="grid min-w-0 gap-1">
                    <span className="font-medium">
                      案件 #{item.number} · {item.targetType}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {item.topic
                        ? `${item.topic.node.name} · ${item.topic.title}`
                        : item.reportedUser
                          ? `${item.reportedUser.name} (@${item.reportedUser.username})`
                          : item.targetKey}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={item.status === "open" ? "destructive" : "outline"}>
                      {item.status}
                    </Badge>
                    <span>{item._count.reports} 次举报</span>
                    <span>优先级 {item.priorityScore}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}
