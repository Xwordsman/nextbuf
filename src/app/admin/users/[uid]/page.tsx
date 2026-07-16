import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminUserActions } from "@/components/admin/admin-user-actions.client";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { AdminError } from "@/modules/admin/errors";
import { getAdminNodes } from "@/modules/admin/content.server";
import { getAdminUserDetail } from "@/modules/admin/users.server";

export const metadata = { title: "用户详情" };

function date(value: Date | null) {
  return value ? value.toLocaleString("zh-CN") : "-";
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
    <main className="admin-page">
      <div className="admin-page-head">
        <div>
          <Link href="/admin/users">← 用户列表</Link>
          <h1>{user.name}</h1>
          <p>
            @{user.username} · UID {user.uid} · {user.email}
          </p>
        </div>
        <Badge variant="neutral">{user.status}</Badge>
      </div>
      <div className="admin-detail-grid">
        <Panel className="admin-section-panel">
          <h2>账号</h2>
          <dl className="admin-status-list">
            <div>
              <dt>邮箱</dt>
              <dd>{user.emailVerified ? "已验证" : "未验证"}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{date(user.createdAt)}</dd>
            </div>
            <div>
              <dt>激活时间</dt>
              <dd>{date(user.activatedAt)}</dd>
            </div>
            <div>
              <dt>注销计划</dt>
              <dd>{date(user.deletionScheduledAt)}</dd>
            </div>
            <div>
              <dt>主题 / 回复</dt>
              <dd>
                {user._count.communityTopics} /{" "}
                {Math.max(user._count.communityPosts - user._count.communityTopics, 0)}
              </dd>
            </div>
            <div>
              <dt>登录方式</dt>
              <dd>{user.accounts.map((account) => account.providerId).join(", ") || "-"}</dd>
            </div>
          </dl>
        </Panel>
        <Panel className="admin-section-panel">
          <h2>信任状态</h2>
          <dl className="admin-status-list">
            <div>
              <dt>当前等级</dt>
              <dd>TL{user.trustState?.currentLevel ?? 0}</dd>
            </div>
            <div>
              <dt>自动等级</dt>
              <dd>TL{user.trustState?.automatedLevel ?? 0}</dd>
            </div>
            <div>
              <dt>人工等级</dt>
              <dd>
                {user.trustState?.manualLevel === null || user.trustState?.manualLevel === undefined
                  ? "-"
                  : `TL${user.trustState.manualLevel}`}
              </dd>
            </div>
            <div>
              <dt>规则版本</dt>
              <dd>v{user.trustState?.ruleVersion.version ?? "-"}</dd>
            </div>
            <div>
              <dt>计算时间</dt>
              <dd>{date(user.trustState?.calculatedAt ?? null)}</dd>
            </div>
          </dl>
        </Panel>
      </div>
      <Panel className="admin-section-panel">
        <h2>受控操作</h2>
        <AdminUserActions
          userId={user.id}
          roles={user.communityRoles}
          nodes={nodes.map(({ id, name, slug }) => ({ id, name, slug }))}
          manualTrustLevel={user.trustState?.manualLevel ?? null}
        />
      </Panel>
      <div className="admin-detail-grid">
        <Panel className="admin-section-panel">
          <div className="admin-section-head">
            <h2>会话</h2>
            <span>{user.sessions.length}</span>
          </div>
          <div className="admin-record-list">
            {user.sessions.length === 0 ? (
              <p>没有有效会话。</p>
            ) : (
              user.sessions.map((item) => (
                <article key={item.id}>
                  <strong>{item.userAgent ?? "未知设备"}</strong>
                  <span>{item.ipAddress ?? "未知地址"}</span>
                  <small>
                    创建 {date(item.createdAt)} · 到期 {date(item.expiresAt)}
                  </small>
                </article>
              ))
            )}
          </div>
        </Panel>
        <Panel className="admin-section-panel">
          <div className="admin-section-head">
            <h2>制裁</h2>
            <span>{user.sanctions.length}</span>
          </div>
          <div className="admin-record-list">
            {user.sanctions.length === 0 ? (
              <p>没有制裁记录。</p>
            ) : (
              user.sanctions.map((item) => (
                <article key={item.id}>
                  <strong>
                    {item.type} · 案件 #{item.case.number}
                  </strong>
                  <span>
                    {item.node?.name ?? "全站"} · {item.revokedAt ? "已撤销" : "有效或待到期"}
                  </span>
                  <small>
                    {item.reason} · {date(item.createdAt)}
                  </small>
                </article>
              ))
            )}
          </div>
        </Panel>
      </div>
      <Panel className="admin-section-panel">
        <div className="admin-section-head">
          <h2>信任历史</h2>
          <span>{user.trustHistories.length}</span>
        </div>
        <div className="admin-record-list admin-record-list-wide">
          {user.trustHistories.map((item) => (
            <article key={item.id}>
              <strong>
                TL{item.fromLevel} → TL{item.toLevel} · {item.source}
              </strong>
              <span>
                规则 v{item.ruleVersion.version}
                {item.actor ? ` · @${item.actor.username}` : ""}
              </span>
              <small>{date(item.createdAt)}</small>
            </article>
          ))}
        </div>
      </Panel>
    </main>
  );
}
