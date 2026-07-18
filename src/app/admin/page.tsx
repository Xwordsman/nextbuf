import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  FileText,
  Mail,
  MessageSquare,
  Scale,
  ServerCog,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/shadcn/ui/alert";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/ui/card";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { AdminError } from "@/modules/admin/errors";
import { getAdminDashboard } from "@/modules/admin/dashboard.server";

export const metadata = { title: "管理后台" };

function date(value: Date) {
  return value.toLocaleString("zh-CN");
}

export default async function AdminDashboardPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin");
  let dashboard: Awaited<ReturnType<typeof getAdminDashboard>>;
  try {
    dashboard = await getAdminDashboard(session.user.id);
  } catch (error) {
    if (error instanceof AdminError && error.status === 403) notFound();
    throw error;
  }

  const metrics = [
    ["用户总数", dashboard.users.total, `今日 +${dashboard.users.today}`, Users],
    ["30 日活跃", dashboard.users.active30d, `注册 ${dashboard.users.thirtyDays}`, Users],
    ["主题", dashboard.content.topics, `今日 +${dashboard.content.topicsToday}`, FileText],
    ["回复", dashboard.content.replies, `今日 +${dashboard.content.repliesToday}`, MessageSquare],
    [
      "待处理案件",
      dashboard.moderation.openCases,
      `${dashboard.moderation.openReports} 份举报`,
      Scale,
    ],
    [
      "待发布 Outbox",
      dashboard.operations.pendingOutbox,
      `${dashboard.operations.failedOutbox} 个错误`,
      Mail,
    ],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">站点概览</h1>
          <p className="text-sm text-muted-foreground">
            注册、活动、内容、治理、队列和系统运行状态。
          </p>
        </div>
        <p className="text-xs text-muted-foreground">更新于 {date(dashboard.generatedAt)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(([label, value, detail, Icon]) => (
          <Card key={label} className="gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between border-b py-3">
              <CardDescription>{label}</CardDescription>
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent className="space-y-1.5 py-4">
              <p className="text-3xl font-semibold tabular-nums">{value}</p>
              <p className="text-xs text-muted-foreground">{detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {dashboard.alerts.length > 0 ? (
        <Alert variant="destructive" className="items-start p-4">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle className="flex items-center gap-2">
            运行告警
            <Badge variant="destructive">{dashboard.alerts.length} 项</Badge>
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-3 space-y-2">
              {dashboard.alerts.map((alert) => (
                <li className="flex items-start gap-2" key={alert.code}>
                  <Badge
                    className="mt-0.5"
                    variant={alert.severity === "critical" ? "destructive" : "outline"}
                  >
                    {alert.severity === "critical" ? "严重" : "警告"}
                  </Badge>
                  <span>{alert.message}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>系统状态</CardTitle>
                <CardDescription>Worker、队列、邮件与信任任务的当前摘要。</CardDescription>
              </div>
              <Badge variant={dashboard.queue.available ? "secondary" : "destructive"}>
                {dashboard.queue.available ? "队列在线" : "队列不可用"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              {[
                ["活跃 Worker", dashboard.operations.activeWorkers],
                ["失败任务", dashboard.operations.unresolvedJobs],
                ["待发送邮件", dashboard.operations.pendingMail],
                ["失败邮件", dashboard.operations.failedMail],
                ["信任批次", dashboard.operations.trustBatches],
                dashboard.queue.available
                  ? [
                      "队列等待 / 执行 / 失败",
                      `${dashboard.queue.waiting} / ${dashboard.queue.active} / ${dashboard.queue.failed}`,
                    ]
                  : ["Redis 队列", dashboard.queue.error],
              ].map(([label, value]) => (
                <div className="flex items-center justify-between gap-6 py-3" key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
          <CardFooter className="gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/worker">
                <ServerCog aria-hidden="true" />
                Worker 运维
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href="/health/ready">
                就绪状态
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>最近注册</CardTitle>
                <CardDescription>最近创建并完成激活的用户。</CardDescription>
              </div>
              <Button asChild size="sm" variant="ghost">
                <Link href="/admin/users">查看全部</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            <div className="divide-y">
              {dashboard.recentUsers.map((user) => (
                <Link
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
                  href={`/admin/users/${user.uid}`}
                  key={user.uid}
                >
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      @{user.username} · UID {user.uid}
                    </span>
                  </span>
                  <span className="grid shrink-0 justify-items-end gap-1.5 text-right">
                    <Badge variant="outline">{user.status}</Badge>
                    <span className="text-xs text-muted-foreground">{date(user.createdAt)}</span>
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
