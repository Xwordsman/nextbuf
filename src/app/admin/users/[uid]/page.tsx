import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AdminPage, AdminPageHeader } from "@/components/admin/admin-page-layout";
import { AdminUserActions } from "@/components/admin/admin-user-actions.client";
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
import { AdminError } from "@/modules/admin/errors";
import { getAdminNodes } from "@/modules/admin/content.server";
import { getAdminUserDetail } from "@/modules/admin/users.server";

export const metadata = { title: "用户详情" };

function date(value: Date | null) {
  return value ? value.toLocaleString("zh-CN") : "-";
}

function DetailList({ items }: { items: readonly [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y text-sm">
      {items.map(([label, value]) => (
        <div className="flex items-start justify-between gap-6 py-3" key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="max-w-[65%] text-right font-medium wrap-break-word">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ uid: string }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const uid = Number((await params).uid);
  if (!session) redirect(`/auth/sign-in?next=/admin/users/${uid}`);
  if (!Number.isSafeInteger(uid) || uid < 1) notFound();
  let user: Awaited<ReturnType<typeof getAdminUserDetail>>;
  let nodes: Awaited<ReturnType<typeof getAdminNodes>>;
  try {
    [user, nodes] = await Promise.all([
      getAdminUserDetail(session.user.id, uid),
      getAdminNodes(session.user.id),
    ]);
  } catch (error) {
    if (error instanceof AdminError && [403, 404].includes(error.status)) notFound();
    throw error;
  }

  return (
    <AdminPage>
      <AdminPageHeader
        actions={
          <>
            <Badge variant="outline">{user.status}</Badge>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/users">
                <ArrowLeft aria-hidden="true" />
                用户列表
              </Link>
            </Button>
          </>
        }
        description={`@${user.username} · UID ${user.uid} · ${user.email}`}
        title={user.name}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>账号</CardTitle>
            <CardDescription>基础身份、内容和登录方式。</CardDescription>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ["邮箱", user.emailVerified ? "已验证" : "未验证"],
                ["创建时间", date(user.createdAt)],
                ["激活时间", date(user.activatedAt)],
                ["注销计划", date(user.deletionScheduledAt)],
                [
                  "主题 / 回复",
                  `${user._count.communityTopics} / ${Math.max(user._count.communityPosts - user._count.communityTopics, 0)}`,
                ],
                ["登录方式", user.accounts.map((account) => account.providerId).join(", ") || "-"],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>信任状态</CardTitle>
            <CardDescription>等级由规则和受控人工操作共同决定。</CardDescription>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ["当前等级", `TL${user.trustState?.currentLevel ?? 0}`],
                ["自动等级", `TL${user.trustState?.automatedLevel ?? 0}`],
                [
                  "人工等级",
                  user.trustState?.manualLevel === null ||
                  user.trustState?.manualLevel === undefined
                    ? "-"
                    : `TL${user.trustState.manualLevel}`,
                ],
                ["规则版本", `v${user.trustState?.ruleVersion.version ?? "-"}`],
                ["计算时间", date(user.trustState?.calculatedAt ?? null)],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>受控操作</CardTitle>
          <CardDescription>所有高风险操作均要求当前 Session 二次验证并写入审计。</CardDescription>
        </CardHeader>
        <CardContent>
          <AdminUserActions
            manualTrustLevel={user.trustState?.manualLevel ?? null}
            nodes={nodes.map(({ id, name, slug }) => ({ id, name, slug }))}
            roles={user.communityRoles}
            userId={user.id}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>会话</CardTitle>
                <CardDescription>脱敏后的已知设备和会话状态。</CardDescription>
              </div>
              <Badge variant="secondary">{user.sessions.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            {user.sessions.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">没有有效会话。</p>
            ) : (
              <div className="divide-y">
                {user.sessions.map((item) => (
                  <article className="grid gap-1 px-4 py-3" key={item.id}>
                    <strong className="text-sm">{item.userAgent ?? "未知设备"}</strong>
                    <span className="text-sm text-muted-foreground">
                      {item.ipAddress ?? "未知地址"}
                    </span>
                    <small className="text-xs text-muted-foreground">
                      创建 {date(item.createdAt)} · 到期 {date(item.expiresAt)}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>制裁</CardTitle>
                <CardDescription>当前及历史的治理制裁记录。</CardDescription>
              </div>
              <Badge variant={user.sanctions.length > 0 ? "destructive" : "secondary"}>
                {user.sanctions.length}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            {user.sanctions.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">没有制裁记录。</p>
            ) : (
              <div className="divide-y">
                {user.sanctions.map((item) => (
                  <article className="grid gap-1 px-4 py-3" key={item.id}>
                    <strong className="text-sm">
                      {item.type} · 案件 #{item.case.number}
                    </strong>
                    <span className="text-sm text-muted-foreground">
                      {item.node?.name ?? "全站"} · {item.revokedAt ? "已撤销" : "有效或待到期"}
                    </span>
                    <small className="text-xs text-muted-foreground">
                      {item.reason} · {date(item.createdAt)}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>信任历史</CardTitle>
              <CardDescription>等级变化的不可变记录。</CardDescription>
            </div>
            <Badge variant="secondary">{user.trustHistories.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <div className="grid divide-y xl:grid-cols-2 xl:divide-x xl:divide-y-0">
            {user.trustHistories.map((item) => (
              <article className="grid gap-1 px-4 py-3" key={item.id}>
                <strong className="text-sm">
                  TL{item.fromLevel} → TL{item.toLevel} · {item.source}
                </strong>
                <span className="text-sm text-muted-foreground">
                  规则 v{item.ruleVersion.version}
                  {item.actor ? ` · @${item.actor.username}` : ""}
                </span>
                <small className="text-xs text-muted-foreground">{date(item.createdAt)}</small>
              </article>
            ))}
          </div>
        </CardContent>
      </Card>
    </AdminPage>
  );
}
