import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
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
    ["用户总数", dashboard.users.total, `今日 +${dashboard.users.today}`],
    ["30 日活跃", dashboard.users.active30d, `注册 ${dashboard.users.thirtyDays}`],
    ["主题", dashboard.content.topics, `今日 +${dashboard.content.topicsToday}`],
    ["回复", dashboard.content.replies, `今日 +${dashboard.content.repliesToday}`],
    ["待处理案件", dashboard.moderation.openCases, `${dashboard.moderation.openReports} 份举报`],
    [
      "待发布 Outbox",
      dashboard.operations.pendingOutbox,
      `${dashboard.operations.failedOutbox} 个错误`,
    ],
  ] as const;
  return (
    <main className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>站点概览</h1>
          <p>注册、活动、内容、治理、队列和系统运行状态。</p>
        </div>
        <span>更新于 {date(dashboard.generatedAt)}</span>
      </div>
      <div className="admin-metric-grid">
        {metrics.map(([label, value, detail]) => (
          <Panel key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </Panel>
        ))}
      </div>
      <div className="admin-dashboard-grid">
        <Panel className="admin-section-panel">
          <div className="admin-section-head">
            <h2>系统状态</h2>
            <Badge variant="neutral">{dashboard.queue.available ? "队列在线" : "队列不可用"}</Badge>
          </div>
          <dl className="admin-status-list">
            <div>
              <dt>活跃 Worker</dt>
              <dd>{dashboard.operations.activeWorkers}</dd>
            </div>
            <div>
              <dt>失败任务</dt>
              <dd>{dashboard.operations.unresolvedJobs}</dd>
            </div>
            <div>
              <dt>待发送邮件</dt>
              <dd>{dashboard.operations.pendingMail}</dd>
            </div>
            <div>
              <dt>失败邮件</dt>
              <dd>{dashboard.operations.failedMail}</dd>
            </div>
            <div>
              <dt>信任批次</dt>
              <dd>{dashboard.operations.trustBatches}</dd>
            </div>
            {dashboard.queue.available ? (
              <div>
                <dt>队列等待 / 执行 / 失败</dt>
                <dd>
                  {dashboard.queue.waiting} / {dashboard.queue.active} / {dashboard.queue.failed}
                </dd>
              </div>
            ) : (
              <div>
                <dt>Redis 队列</dt>
                <dd>{dashboard.queue.error}</dd>
              </div>
            )}
          </dl>
          <div className="admin-panel-actions">
            <Link href="/admin/worker">打开 Worker 运维</Link>
            <Link href="/health/ready">检查就绪状态</Link>
          </div>
        </Panel>
        <Panel className="admin-section-panel">
          <div className="admin-section-head">
            <h2>最近注册</h2>
            <Link href="/admin/users">查看全部</Link>
          </div>
          <div className="admin-compact-list">
            {dashboard.recentUsers.map((user) => (
              <Link href={`/admin/users/${user.uid}`} key={user.uid}>
                <span>
                  <strong>{user.name}</strong>
                  <small>
                    @{user.username} · UID {user.uid}
                  </small>
                </span>
                <span>
                  <Badge variant="neutral">{user.status}</Badge>
                  <small>{date(user.createdAt)}</small>
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </main>
  );
}
