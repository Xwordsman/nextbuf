import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Filter, Search } from "lucide-react";
import { AdminPage, AdminPageHeader, AdminPagination } from "@/components/admin/admin-page-layout";
import { AdminAuditExport } from "@/components/admin/admin-audit-export.client";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/ui/card";
import { Input } from "@/components/shadcn/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select";
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
    <AdminPage>
      <AdminPageHeader description="身份、社区和治理事件的统一只读视图。" title="审计日志" />

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter aria-hidden="true" className="size-4" />
            筛选审计事件
          </CardTitle>
          <CardDescription>导出会记录审计事件，且需要当前管理员重新验证。</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action="/admin/audit"
            className="grid gap-3 md:grid-cols-2 xl:grid-cols-[10rem_minmax(0,1fr)_10rem_10rem_10rem_auto]"
          >
            <Select defaultValue={source} name="source">
              <SelectTrigger aria-label="审计来源" className="w-full">
                <SelectValue placeholder="全部来源" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部来源</SelectItem>
                <SelectItem value="identity">identity</SelectItem>
                <SelectItem value="community">community</SelectItem>
                <SelectItem value="governance">governance</SelectItem>
              </SelectContent>
            </Select>
            <Input
              aria-label="操作名称"
              defaultValue={params.action ?? ""}
              name="action"
              placeholder="操作名称"
            />
            <Input
              aria-label="操作者 UID"
              defaultValue={params.actor ?? ""}
              inputMode="numeric"
              name="actor"
              placeholder="操作者 UID"
            />
            <Input aria-label="开始日期" defaultValue={params.from ?? ""} name="from" type="date" />
            <Input aria-label="结束日期" defaultValue={params.to ?? ""} name="to" type="date" />
            <Button type="submit">
              <Search aria-hidden="true" />
              筛选
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>审计事件</CardTitle>
          <CardDescription>所有记录均为只读事实，敏感字段会在导出前脱敏。</CardDescription>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <AdminAuditExport
            filters={{
              source,
              action: params.action || undefined,
              actorUid,
              from: from?.toISOString(),
              to: to?.toISOString(),
            }}
          />
          {result.items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              没有符合条件的审计事件。
            </p>
          ) : (
            <div className="divide-y">
              {result.items.map((event) => (
                <article className="space-y-3 px-4 py-4" key={event.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{event.source}</Badge>
                    <strong className="text-sm">{event.action}</strong>
                    <span className="text-xs text-muted-foreground">
                      {event.createdAt.toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span>
                      {event.actor ? `UID ${event.actor.uid} · @${event.actor.username}` : "system"}
                    </span>
                    <span>
                      {event.targetType}: {event.targetKey}
                    </span>
                    {event.requestId ? <code className="text-xs">{event.requestId}</code> : null}
                  </div>
                  <pre className="max-h-52 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs whitespace-pre-wrap wrap-break-word">
                    {JSON.stringify(event.detail, null, 2)}
                  </pre>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AdminPagination
        nextHref={result.hasMore ? pageHref(page + 1) : undefined}
        previousHref={page > 1 ? pageHref(page - 1) : undefined}
      />
    </AdminPage>
  );
}
