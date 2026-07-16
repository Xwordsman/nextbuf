import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
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
  return (
    <main className="moderation-page">
      <div className="account-page-head">
        <h1>治理案件</h1>
        <p>举报按目标聚合；处置、制裁和结案均保留不可变审计记录。</p>
      </div>
      <nav className="moderation-status-tabs" aria-label="案件状态">
        {[
          ["open", "待处理"],
          ["in_review", "处理中"],
          ["resolved", "已结案"],
          ["dismissed", "已驳回"],
          ["all", "全部"],
        ].map(([value, label]) => (
          <Link
            key={value}
            href={`/admin/moderation?status=${value}`}
            aria-current={status === value ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Panel className="moderation-case-list">
        {cases.map((item) => (
          <Link
            className="moderation-case-row"
            href={`/admin/moderation/${item.number}`}
            key={item.id}
          >
            <div>
              <span className="moderation-case-title">
                案件 #{item.number} · {item.targetType}
              </span>
              <small>
                {item.topic
                  ? `${item.topic.node.name} · ${item.topic.title}`
                  : item.reportedUser
                    ? `${item.reportedUser.name} (@${item.reportedUser.username})`
                    : item.targetKey}
              </small>
            </div>
            <div className="moderation-case-stats">
              <Badge>{item.status}</Badge>
              <span>{item._count.reports} 次举报</span>
              <span>优先级 {item.priorityScore}</span>
            </div>
          </Link>
        ))}
        {cases.length === 0 ? <p className="moderation-empty">当前筛选下没有案件。</p> : null}
      </Panel>
    </main>
  );
}
