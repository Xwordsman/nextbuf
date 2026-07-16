import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminAuditExport } from "@/components/admin/admin-audit-export.client";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { listAdminAuditEvents, type AuditSource } from "@/modules/admin/audit.server";
import { AdminError } from "@/modules/admin/errors";

export const metadata = { title: "审计日志" };

function parseDate(value: string | undefined, end = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+08:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    source?: string;
    action?: string;
    actor?: string;
    from?: string;
    to?: string;
    page?: string;
  }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin/audit");
  const params = await searchParams;
  const source = ["identity", "community", "governance"].includes(params.source ?? "")
    ? (params.source as AuditSource)
    : "all";
  const actorUid = params.actor && /^\d+$/.test(params.actor) ? Number(params.actor) : undefined;
  const page = params.page && /^\d+$/.test(params.page) ? Number(params.page) : 1;
  const from = parseDate(params.from);
  const to = parseDate(params.to, true);
  let result: Awaited<ReturnType<typeof listAdminAuditEvents>>;
  try {
    result = await listAdminAuditEvents(session.user.id, {
      source,
      action: params.action,
      actorUid,
      from,
      to,
      page,
    });
  } catch (error) {
    if (error instanceof AdminError && error.status === 403) notFound();
    throw error;
  }
  const query = new URLSearchParams();
  if (source !== "all") query.set("source", source);
  if (params.action) query.set("action", params.action);
  if (params.actor) query.set("actor", params.actor);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  const pageHref = (value: number) => {
    const copy = new URLSearchParams(query);
    copy.set("page", String(value));
    return `/admin/audit?${copy}`;
  };
  return (
    <main className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>审计日志</h1>
          <p>身份、社区和治理事件的统一只读视图。</p>
        </div>
      </div>
      <Panel className="admin-filter-panel">
        <form action="/admin/audit">
          <select name="source" defaultValue={source}>
            <option value="all">全部来源</option>
            <option value="identity">identity</option>
            <option value="community">community</option>
            <option value="governance">governance</option>
          </select>
          <input name="action" defaultValue={params.action ?? ""} placeholder="操作名称" />
          <input
            name="actor"
            defaultValue={params.actor ?? ""}
            inputMode="numeric"
            placeholder="操作者 UID"
          />
          <input name="from" type="date" defaultValue={params.from ?? ""} aria-label="开始日期" />
          <input name="to" type="date" defaultValue={params.to ?? ""} aria-label="结束日期" />
          <button type="submit">筛选</button>
        </form>
      </Panel>
      <Panel className="admin-section-panel">
        <AdminAuditExport
          filters={{
            source,
            action: params.action || undefined,
            actorUid,
            from: from?.toISOString(),
            to: to?.toISOString(),
          }}
        />
        <div className="admin-audit-list">
          {result.items.length === 0 ? (
            <p>没有符合条件的审计事件。</p>
          ) : (
            result.items.map((event) => (
              <article key={event.id}>
                <div>
                  <Badge variant="neutral">{event.source}</Badge>
                  <strong>{event.action}</strong>
                  <span>{event.createdAt.toLocaleString("zh-CN")}</span>
                </div>
                <div>
                  <span>
                    {event.actor ? `UID ${event.actor.uid} · @${event.actor.username}` : "system"}
                  </span>
                  <span>
                    {event.targetType}: {event.targetKey}
                  </span>
                  {event.requestId ? <code>{event.requestId}</code> : null}
                </div>
                <pre>{JSON.stringify(event.detail, null, 2)}</pre>
              </article>
            ))
          )}
        </div>
      </Panel>
      <div className="admin-pagination">
        {page > 1 ? <Link href={pageHref(page - 1)}>上一页</Link> : <span />}
        {result.hasMore ? <Link href={pageHref(page + 1)}>下一页</Link> : null}
      </div>
    </main>
  );
}
