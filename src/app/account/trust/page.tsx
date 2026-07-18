import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountPageShell } from "@/components/account/account-page-shell";
import { Badge } from "@/components/shadcn/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/ui/card";
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
    <AccountPageShell
      active="trust"
      description="查看当前等级、自动计算指标、降级宽限期和历史变更。"
      title="信任等级"
    >
      <div className="grid gap-5">
        <div className="grid gap-5 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>当前等级</CardDescription>
              <CardTitle>
                <strong className="text-3xl font-semibold tracking-normal">
                  TL{overview.currentLevel}
                </strong>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5">
              <p className="text-sm text-muted-foreground">
                自动计算为 TL{overview.automatedLevel}
                {overview.manualLevel === 4 ? "，TL4 由管理员人工确认" : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                规则 v{overview.ruleVersion.version} ·{" "}
                {overview.calculatedAt.toLocaleString("zh-CN")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>等级状态</CardDescription>
              <CardTitle>
                <strong className="text-3xl font-semibold tracking-normal">
                  {overview.graceUntil ? "宽限期" : "正常"}
                </strong>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5">
              <p className="text-sm leading-6 text-muted-foreground">
                {overview.graceUntil
                  ? `若指标未恢复，将在 ${overview.graceUntil.toLocaleString("zh-CN")} 后降级。`
                  : "升级达到规则后立即生效；降级会先进入宽限期。"}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                管理角色、专业声誉和交易信用不由 TL 授予。
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>
              <h2>计算指标</h2>
            </CardTitle>
            <CardAction className="self-center">
              <Badge variant="secondary" className="rounded-md">
                TL{overview.automatedLevel}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="p-0">
            <dl className="grid divide-y sm:grid-cols-5 sm:divide-x sm:divide-y-0">
              {metricLabels.map(([key, label]) => (
                <div className="grid gap-1 px-5 py-4 sm:px-4" key={key}>
                  <dt className="order-2 text-xs text-muted-foreground">{label}</dt>
                  <dd className="order-1 text-xl font-semibold tabular-nums text-foreground">
                    {values[key]}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="border-t px-5 py-4 sm:px-6">
              <h3 className="mb-3 text-sm font-medium">升级条件</h3>
              <div className="grid divide-y rounded-lg border">
                {([1, 2, 3] as const).map((level) => {
                  const required = rule.levels[String(level) as "1" | "2" | "3"];
                  const met =
                    values.accountAgeDays >= required.accountAgeDays &&
                    values.readTopics >= required.readTopics &&
                    values.posts >= required.posts &&
                    values.likesReceived >= required.likesReceived &&
                    values.recentViolations <= required.recentViolationsMax;
                  return (
                    <div
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3"
                      key={level}
                    >
                      <Badge variant={met ? "secondary" : "outline"} className="rounded-md">
                        TL{level}
                      </Badge>
                      <span className="text-xs leading-5 text-muted-foreground">
                        {required.accountAgeDays} 天 · 阅读 {required.readTopics} · 发帖{" "}
                        {required.posts} · 获赞 {required.likesReceived} · 违规不超过{" "}
                        {required.recentViolationsMax}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>
              <h2>等级历史</h2>
            </CardTitle>
            <CardAction className="self-center text-xs tabular-nums text-muted-foreground">
              {history.length} 条
            </CardAction>
          </CardHeader>
          <CardContent className="p-0">
            {history.map((item) => (
              <div className="grid gap-1 border-b px-5 py-4 last:border-b-0 sm:px-6" key={item.id}>
                <span className="text-sm font-medium">
                  TL{item.fromLevel} → TL{item.toLevel}
                </span>
                <small className="text-xs leading-5 text-muted-foreground">
                  {item.source} · 规则 v{item.ruleVersion.version} ·{" "}
                  {item.createdAt.toLocaleString("zh-CN")}
                </small>
              </div>
            ))}
            {history.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground sm:px-6">
                尚无等级变更记录。
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4">
            <CardTitle>
              <h2>治理记录</h2>
            </CardTitle>
            <CardAction className="self-center text-xs tabular-nums text-muted-foreground">
              {sanctions.length} 条
            </CardAction>
          </CardHeader>
          <CardContent className="p-0">
            {sanctions.map((sanction) => (
              <div
                className="grid gap-1 border-b px-5 py-4 last:border-b-0 sm:px-6"
                key={sanction.id}
              >
                <span className="text-sm font-medium">
                  {sanction.type}
                  {sanction.node ? ` · ${sanction.node.name}` : ""}
                </span>
                <small className="text-xs leading-5 text-muted-foreground">
                  {sanction.reason} · {sanction.startsAt.toLocaleString("zh-CN")}
                  {sanction.revokedAt
                    ? " · 已撤销"
                    : sanction.endsAt
                      ? ` · 至 ${sanction.endsAt.toLocaleString("zh-CN")}`
                      : ""}
                </small>
              </div>
            ))}
            {sanctions.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground sm:px-6">
                没有警告、禁言、暂停或封禁记录。
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </AccountPageShell>
  );
}
