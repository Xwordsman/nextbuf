import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { AdminPage, AdminPageHeader } from "@/components/admin/admin-page-layout";
import { ModerationCaseActions } from "@/components/moderation/case-actions.client";
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
    <AdminPage>
      <AdminPageHeader
        actions={
          <>
            <Badge variant={item.status === "open" ? "destructive" : "outline"}>
              {item.status}
            </Badge>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/moderation">
                <ArrowLeft aria-hidden="true" />
                案件列表
              </Link>
            </Button>
          </>
        }
        description={`案件 #${item.number} · ${item.targetType}`}
        title="案件详情"
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle>举报目标</CardTitle>
          <CardDescription>
            {item.targetType} · {item.targetKey}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["优先级", item.priorityScore],
              ["举报数", item.reports.length],
              ["创建时间", item.createdAt.toLocaleString("zh-CN")],
            ].map(([label, value]) => (
              <div className="grid gap-1 rounded-lg border p-4" key={label}>
                <span className="text-xs text-muted-foreground">{label}</span>
                <strong className="text-sm">{value}</strong>
              </div>
            ))}
          </div>
          {targetHref ? (
            <Button asChild size="sm" variant="outline">
              <Link href={targetHref}>
                <ExternalLink aria-hidden="true" />
                查看当前目标
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {["open", "in_review"].includes(item.status) ? (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>执行处置</CardTitle>
            <CardDescription>处置、制裁和结案都会记录原因、操作者和请求信息。</CardDescription>
          </CardHeader>
          <CardContent>
            <ModerationCaseActions
              caseNumber={item.number}
              hasNode={Boolean(item.topic)}
              isAdmin={detail.permissions.isAdmin}
              isGlobalModerator={detail.permissions.isGlobalModerator}
              sanctions={item.sanctions.map((sanction) => ({
                id: sanction.id,
                type: sanction.type,
                revokedAt: sanction.revokedAt?.toISOString() ?? null,
              }))}
              targetType={item.targetType}
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>举报来源</CardTitle>
            <CardDescription>提交举报时保存的目标快照。</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="divide-y">
              {item.reports.map((report) => (
                <article className="space-y-3 px-4 py-4" key={report.id}>
                  <strong className="text-sm">
                    {report.reason} · 权重 {report.weight}
                  </strong>
                  <p className="text-sm text-muted-foreground">
                    {report.details || "未填写补充说明"}
                  </p>
                  <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs whitespace-pre-wrap wrap-break-word">
                    {JSON.stringify(report.snapshot, null, 2)}
                  </pre>
                  <small className="text-xs text-muted-foreground">
                    {report.reporter.name} (@{report.reporter.username}) · TL
                    {report.reporterTrustLevel} · {report.createdAt.toLocaleString("zh-CN")}
                  </small>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>处置记录</CardTitle>
            <CardDescription>对案件执行的不可变治理审计。</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {item.actions.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">尚未执行处置。</p>
            ) : (
              <div className="divide-y">
                {item.actions.map((action) => (
                  <article className="space-y-3 px-4 py-4" key={action.id}>
                    <strong className="text-sm">{action.action}</strong>
                    <p className="text-sm text-muted-foreground">{action.reason}</p>
                    <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/50 p-3 text-xs whitespace-pre-wrap wrap-break-word">
                      {JSON.stringify(
                        { before: action.beforeState, after: action.afterState },
                        null,
                        2,
                      )}
                    </pre>
                    <small className="text-xs text-muted-foreground">
                      {action.actor.name} (@{action.actor.username}) ·{" "}
                      {action.createdAt.toLocaleString("zh-CN")} · 请求 {action.requestId}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminPage>
  );
}
