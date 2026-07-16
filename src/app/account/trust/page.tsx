import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/account/account-nav";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getUserModerationHistory } from "@/modules/moderation/queries.server";
import { parseTrustRuleConfig, type TrustMetrics } from "@/modules/trust/policy";
import { getTrustHistory, getTrustOverview } from "@/modules/trust/trust.server";

export const metadata = { title: "信任等级" };

function metrics(value: unknown): TrustMetrics {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const number = (key: keyof TrustMetrics) => {
    const item = key in source ? (source as Record<string, unknown>)[key] : 0;
    return typeof item === "number" ? item : 0;
  };
  return {
    accountAgeDays: number("accountAgeDays"),
    readTopics: number("readTopics"),
    posts: number("posts"),
    likesReceived: number("likesReceived"),
    recentViolations: number("recentViolations"),
  };
}

const metricLabels: Array<[keyof TrustMetrics, string]> = [
  ["accountAgeDays", "账号时长（天）"],
  ["readTopics", "已读主题"],
  ["posts", "有效主题与回复"],
  ["likesReceived", "收到点赞"],
  ["recentViolations", "近期有效违规"],
];

export default async function AccountTrustPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account/trust");
  const [overview, history, sanctions] = await Promise.all([
    getTrustOverview(session.user.id),
    getTrustHistory(session.user.id),
    getUserModerationHistory(session.user.id),
  ]);
  if (!overview) throw new Error("Trust state is missing for the current user");
  const values = metrics(overview.metrics);
  const rule = parseTrustRuleConfig(overview.ruleVersion.config);

  return (
    <main className="account-page">
      <div className="account-page-head">
        <h1>信任等级</h1>
        <p>查看当前等级、自动计算指标、降级宽限期和历史变更。</p>
      </div>
      <AccountNav active="trust" />

      <div className="trust-overview-grid">
        <Panel className="trust-level-panel">
          <span>当前等级</span>
          <strong>TL{overview.currentLevel}</strong>
          <p>
            自动计算为 TL{overview.automatedLevel}
            {overview.manualLevel === 4 ? "，TL4 由管理员人工确认" : ""}
          </p>
          <small>
            规则 v{overview.ruleVersion.version} · {overview.calculatedAt.toLocaleString("zh-CN")}
          </small>
        </Panel>
        <Panel className="trust-level-panel">
          <span>等级状态</span>
          <strong>{overview.graceUntil ? "宽限期" : "正常"}</strong>
          <p>
            {overview.graceUntil
              ? `若指标未恢复，将在 ${overview.graceUntil.toLocaleString("zh-CN")} 后降级。`
              : "升级达到规则后立即生效；降级会先进入宽限期。"}
          </p>
          <small>管理角色、专业声誉和交易信用不由 TL 授予。</small>
        </Panel>
      </div>

      <Panel className="trust-section">
        <div className="trust-section-head">
          <h2>计算指标</h2>
          <Badge variant="trust">TL{overview.automatedLevel}</Badge>
        </div>
        <div className="trust-metric-grid">
          {metricLabels.map(([key, label]) => (
            <div key={key}>
              <span>{label}</span>
              <strong>{values[key]}</strong>
            </div>
          ))}
        </div>
        <div className="trust-rule-levels">
          {([1, 2, 3] as const).map((level) => {
            const required = rule.levels[String(level) as "1" | "2" | "3"];
            const met =
              values.accountAgeDays >= required.accountAgeDays &&
              values.readTopics >= required.readTopics &&
              values.posts >= required.posts &&
              values.likesReceived >= required.likesReceived &&
              values.recentViolations <= required.recentViolationsMax;
            return (
              <div key={level}>
                <Badge variant={met ? "trust" : "neutral"}>TL{level}</Badge>
                <span>
                  {required.accountAgeDays} 天 · 阅读 {required.readTopics} · 发帖 {required.posts}{" "}
                  · 获赞 {required.likesReceived} · 违规不超过 {required.recentViolationsMax}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel className="trust-section">
        <div className="trust-section-head">
          <h2>等级历史</h2>
          <span>{history.length} 条</span>
        </div>
        <div className="trust-history-list">
          {history.map((item) => (
            <div key={item.id}>
              <span>
                TL{item.fromLevel} → TL{item.toLevel}
              </span>
              <small>
                {item.source} · 规则 v{item.ruleVersion.version} ·{" "}
                {item.createdAt.toLocaleString("zh-CN")}
              </small>
            </div>
          ))}
          {history.length === 0 ? <p>尚无等级变更记录。</p> : null}
        </div>
      </Panel>

      <Panel className="trust-section">
        <div className="trust-section-head">
          <h2>治理记录</h2>
          <span>{sanctions.length} 条</span>
        </div>
        <div className="trust-history-list">
          {sanctions.map((sanction) => (
            <div key={sanction.id}>
              <span>
                {sanction.type}
                {sanction.node ? ` · ${sanction.node.name}` : ""}
              </span>
              <small>
                {sanction.reason} · {sanction.startsAt.toLocaleString("zh-CN")}
                {sanction.revokedAt
                  ? ` · 已撤销`
                  : sanction.endsAt
                    ? ` · 至 ${sanction.endsAt.toLocaleString("zh-CN")}`
                    : ""}
              </small>
            </div>
          ))}
          {sanctions.length === 0 ? <p>没有警告、禁言、暂停或封禁记录。</p> : null}
        </div>
      </Panel>
    </main>
  );
}
