import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { WorkerActions, WorkerReplayButton } from "@/components/admin/worker-actions.client";
import { Panel } from "@/components/ui/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  return (
    <main className="worker-operations-page">
      <div className="account-page-head worker-operations-head">
        <div>
          <h1>Worker 运维</h1>
          <p>队列、Outbox、邮件投递和可恢复失败任务。</p>
        </div>
        <WorkerActions />
      </div>
      <div className="worker-metrics">
        <Panel>
          <span>队列等待</span>
          <strong>{summary.queue.available ? summary.queue.counts.waiting : "-"}</strong>
        </Panel>
        <Panel>
          <span>队列失败</span>
          <strong>{summary.queue.available ? summary.queue.counts.failed : "-"}</strong>
        </Panel>
        <Panel>
          <span>Outbox 待发布</span>
          <strong>{summary.outbox.pending}</strong>
        </Panel>
        <Panel>
          <span>邮件待发送</span>
          <strong>{summary.mail.pending}</strong>
        </Panel>
      </div>
      {!summary.queue.available ? (
        <p className="worker-queue-error">Redis 队列不可用：{summary.queue.error}</p>
      ) : null}

      <Panel className="worker-table-panel">
        <div className="worker-section-head">
          <h2>失败任务</h2>
          <span>{summary.failures.length} 个未解决</span>
        </div>
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
                <TableCell colSpan={5}>没有未解决的失败任务。</TableCell>
              </TableRow>
            ) : (
              summary.failures.map((failure) => (
                <TableRow key={failure.id}>
                  <TableCell>
                    <code>{failure.jobId}</code>
                  </TableCell>
                  <TableCell>{failure.attempts}</TableCell>
                  <TableCell className="worker-error-cell">{failure.lastError}</TableCell>
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
      </Panel>

      <div className="worker-operations-grid">
        <Panel className="worker-table-panel">
          <div className="worker-section-head">
            <h2>Worker 实例</h2>
            <span>{summary.workers.length}</span>
          </div>
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
                    <code>{worker.workerId}</code>
                  </TableCell>
                  <TableCell>{worker.status}</TableCell>
                  <TableCell>{date(worker.heartbeatAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
        <Panel className="worker-table-panel">
          <div className="worker-section-head">
            <h2>周期任务</h2>
            <span>{summary.tasks.length}</span>
          </div>
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
                    <code>{task.name}</code>
                  </TableCell>
                  <TableCell>{date(task.nextRunAt)}</TableCell>
                  <TableCell>{task.runCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>
    </main>
  );
}
