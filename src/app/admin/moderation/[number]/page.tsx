import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ModerationCaseActions } from "@/components/moderation/case-actions.client";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { ModerationError } from "@/modules/moderation/errors";
import { getModerationCaseDetail } from "@/modules/moderation/queries.server";

export const metadata = { title: "案件详情" };

export default async function ModerationCasePage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const caseNumber = Number((await params).number);
  if (!session) redirect(`/auth/sign-in?next=/admin/moderation/${caseNumber}`);
  if (!Number.isSafeInteger(caseNumber) || caseNumber < 1) notFound();
  let detail;
  try {
    detail = await getModerationCaseDetail(session.user.id, caseNumber);
  } catch (error) {
    if (error instanceof ModerationError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const item = detail.moderationCase;
  const targetHref =
    item.targetType === "user" && item.reportedUser
      ? `/u/${item.reportedUser.username}`
      : item.topic
        ? `/topics/${item.topic.number}${item.post ? `#post-${item.post.position}` : ""}`
        : null;
  return (
    <main className="moderation-page">
      <div className="account-page-head moderation-case-head">
        <div>
          <Link href="/admin/moderation">返回案件列表</Link>
          <h1>案件 #{item.number}</h1>
        </div>
        <Badge>{item.status}</Badge>
      </div>
      <Panel className="moderation-case-summary">
        <h2>举报目标</h2>
        <p>
          {item.targetType} · {item.targetKey}
        </p>
        {targetHref ? <Link href={targetHref}>查看当前目标</Link> : null}
        <dl>
          <div>
            <dt>优先级</dt>
            <dd>{item.priorityScore}</dd>
          </div>
          <div>
            <dt>举报数</dt>
            <dd>{item.reports.length}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{item.createdAt.toLocaleString("zh-CN")}</dd>
          </div>
        </dl>
      </Panel>
      {["open", "in_review"].includes(item.status) ? (
        <Panel className="moderation-case-workbench">
          <h2>执行处置</h2>
          <ModerationCaseActions
            caseNumber={item.number}
            targetType={item.targetType}
            isAdmin={detail.permissions.isAdmin}
            isGlobalModerator={detail.permissions.isGlobalModerator}
            hasNode={Boolean(item.topic)}
            sanctions={item.sanctions.map((sanction) => ({
              id: sanction.id,
              type: sanction.type,
              revokedAt: sanction.revokedAt?.toISOString() ?? null,
            }))}
          />
        </Panel>
      ) : null}
      <div className="moderation-detail-grid">
        <Panel className="moderation-case-section">
          <h2>举报来源</h2>
          {item.reports.map((report) => (
            <article key={report.id}>
              <strong>
                {report.reason} · 权重 {report.weight}
              </strong>
              <p>{report.details || "未填写补充说明"}</p>
              <pre>{JSON.stringify(report.snapshot, null, 2)}</pre>
              <small>
                {report.reporter.name} (@{report.reporter.username}) · TL{report.reporterTrustLevel}{" "}
                · {report.createdAt.toLocaleString("zh-CN")}
              </small>
            </article>
          ))}
        </Panel>
        <Panel className="moderation-case-section">
          <h2>处置记录</h2>
          {item.actions.map((action) => (
            <article key={action.id}>
              <strong>{action.action}</strong>
              <p>{action.reason}</p>
              <pre>
                {JSON.stringify({ before: action.beforeState, after: action.afterState }, null, 2)}
              </pre>
              <small>
                {action.actor.name} (@{action.actor.username}) ·{" "}
                {action.createdAt.toLocaleString("zh-CN")} · 请求 {action.requestId}
              </small>
            </article>
          ))}
          {item.actions.length === 0 ? <p>尚未执行处置。</p> : null}
        </Panel>
      </div>
    </main>
  );
}
