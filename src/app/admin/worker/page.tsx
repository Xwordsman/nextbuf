import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, Mail, Send, ServerCog } from "lucide-react";
import { AdminPage, AdminPageHeader } from "@/components/admin/admin-page-layout";
import { WorkerActions, WorkerReplayButton } from "@/components/admin/worker-actions.client";
import { Alert, AlertDescription, AlertTitle } from "@/components/shadcn/ui/alert";
import { Badge } from "@/components/shadcn/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/ui/table";
import { getAuth } from "@/infrastructure/auth/better-auth";
import {
  getWorkerOperationsSummary,
  WorkerOperationsError,
} from "@/modules/worker/operations.server";

export const metadata = { title: "Worker 运维" };

function date(value: Date | null): string {
  return value ? value.toLocaleString("zh-CN") : "-";
}

export default async function WorkerOperationsPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin/worker");
  let summary: Awaited<ReturnType<typeof getWorkerOperationsSummary>>;
  try {
    summary = await getWorkerOperationsSummary(session.user.id);
  } catch (error) {
    if (error instanceof WorkerOperationsError && error.status === 403) notFound();
    throw error;
  }

  const metrics = [
    ["队列等待", summary.queue.available ? summary.queue.counts.waiting : "-", ServerCog],
    ["队列失败", summary.queue.available ? summary.queue.counts.failed : "-", AlertTriangle],
    ["Outbox 待发布", summary.outbox.pending, Send],
    ["邮件待发送", summary.mail.pending, Mail],
  ] as const;

  return (
    <AdminPage>
      <AdminPageHeader
        actions={<WorkerActions />}
        description="队列、Outbox、邮件投递和可恢复失败任务。"
        title="Worker 运维"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, Icon]) => (
          <Card key={label} className="gap-0 py-0">
            <CardHeader className="flex-row items-center justify-between border-b py-3">
              <CardDescription>{label}</CardDescription>
              <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="py-4 text-3xl font-semibold tabular-nums">{value}</CardContent>
          </Card>
        ))}
      </div>

      {!summary.queue.available ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Redis 队列不可用</AlertTitle>
          <AlertDescription>{summary.queue.error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>失败任务</CardTitle>
              <CardDescription>可恢复失败任务需要登记重放，不直接绕过审计。</CardDescription>
            </div>
            <Badge variant={summary.failures.length > 0 ? "destructive" : "secondary"}>
              {summary.failures.length} 个未解决
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>任务</TableHead>
                <TableHead>尝试</TableHead>
                <TableHead>错误</TableHead>
                <TableHead>失败时间</TableHead>
                <TableHead>重放</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.failures.length === 0 ? (
                <TableRow>
                  <TableCell className="h-28 text-center text-muted-foreground" colSpan={5}>
                    没有未解决的失败任务。
                  </TableCell>
                </TableRow>
              ) : (
                summary.failures.map((failure) => (
                  <TableRow key={failure.id}>
                    <TableCell>
                      <code className="text-xs">{failure.jobId}</code>
                    </TableCell>
                    <TableCell>{failure.attempts}</TableCell>
                    <TableCell className="max-w-md whitespace-normal text-destructive">
                      {failure.lastError}
                    </TableCell>
                    <TableCell>{date(failure.failedAt)}</TableCell>
                    <TableCell>
                      {failure.replayRequestedAt ? (
                        "已请求"
                      ) : (
                        <WorkerReplayButton failureId={failure.id} />
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Worker 实例</CardTitle>
                <CardDescription>最近活跃的 Worker 心跳。</CardDescription>
              </div>
              <Badge variant="secondary">{summary.workers.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>实例</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>心跳</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.workers.map((worker) => (
                  <TableRow key={worker.workerId}>
                    <TableCell>
                      <code className="text-xs">{worker.workerId}</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{worker.status}</Badge>
                    </TableCell>
                    <TableCell>{date(worker.heartbeatAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>周期任务</CardTitle>
                <CardDescription>按租约执行的当前调度计划。</CardDescription>
              </div>
              <Badge variant="secondary">{summary.tasks.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="px-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>下次运行</TableHead>
                  <TableHead>次数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.tasks.map((task) => (
                  <TableRow key={task.name}>
                    <TableCell>
                      <code className="text-xs">{task.name}</code>
                    </TableCell>
                    <TableCell>{date(task.nextRunAt)}</TableCell>
                    <TableCell className="tabular-nums">{task.runCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AdminPage>
  );
}
