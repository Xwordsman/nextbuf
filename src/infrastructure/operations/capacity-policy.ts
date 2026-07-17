export type OperationalSignals = {
  activeWorkers: number;
  pendingOutbox: number;
  failedOutbox: number;
  pendingMail: number;
  failedMail: number;
  unresolvedJobs: number;
  queue:
    | { available: true; waiting: number; active: number; failed: number }
    | { available: false; error: string };
};

export type OperationalAlert = {
  code: string;
  severity: "warning" | "critical";
  message: string;
};

export function buildOperationalAlerts(signals: OperationalSignals): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  if (signals.activeWorkers < 1) {
    alerts.push({
      code: "worker_unavailable",
      severity: "critical",
      message: "没有处于就绪状态的 Worker，邮件、通知和异步处理会停止。",
    });
  }
  if (!signals.queue.available) {
    alerts.push({
      code: "queue_unavailable",
      severity: "critical",
      message: "Redis 队列不可用，请检查 Redis、网络和凭据。",
    });
  } else {
    if (signals.queue.waiting >= 500) {
      alerts.push({
        code: "queue_backlog",
        severity: "warning",
        message: `队列已有 ${signals.queue.waiting} 个等待任务，需要检查 Worker 容量或失败重试。`,
      });
    }
    if (signals.queue.failed > 0) {
      alerts.push({
        code: "queue_failures",
        severity: "warning",
        message: `BullMQ 保留了 ${signals.queue.failed} 个失败任务。`,
      });
    }
  }
  if (signals.pendingOutbox >= 500) {
    alerts.push({
      code: "outbox_backlog",
      severity: "warning",
      message: `PostgreSQL 中有 ${signals.pendingOutbox} 个待发布 Outbox 事件。`,
    });
  }
  if (signals.failedOutbox > 0 || signals.failedMail > 0 || signals.unresolvedJobs > 0) {
    alerts.push({
      code: "persistent_failures",
      severity: "warning",
      message: `存在持久化失败：Outbox ${signals.failedOutbox}、邮件 ${signals.failedMail}、任务 ${signals.unresolvedJobs}。`,
    });
  }
  return alerts;
}
