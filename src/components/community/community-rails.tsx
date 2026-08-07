import Link from "next/link";
import {
  ArrowUpRight,
  Bot,
  Code2,
  Globe2,
  LayoutGrid,
  LogIn,
  Network,
  Server,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/shadcn/ui/card";
import { cn } from "@/lib/utils";
import type {
  CommunityNodeIcon,
  CommunityNodeView,
  CommunityTopicView,
  CommunityUserView,
} from "@/modules/community/contracts/home-view";
import type { CurrentAccountView } from "@/modules/identity/session.server";

const nodeIcons: Record<CommunityNodeIcon, LucideIcon> = {
  grid: LayoutGrid,
  bot: Bot,
  code: Code2,
  server: Server,
  globe: Globe2,
  network: Network,
  sparkles: Sparkles,
};

type CommunityRightRailProps = {
  account: CurrentAccountView | null;
  overview: Array<{ label: string; value: string }>;
  hotTopics: CommunityTopicView[];
  onlineMembers: Array<Pick<CommunityUserView, "name" | "avatarUrl" | "initials">>;
  sticky?: boolean;
};

export function CommunityNodeNavigation({
  nodes,
  activeNodeId = "all",
}: {
  nodes: CommunityNodeView[];
  activeNodeId?: string;
}) {
  return (
    <Card
      size="sm"
      className="sticky top-[calc(var(--header-height)+18px)] gap-1 overflow-visible py-2 max-[860px]:static max-[860px]:overflow-hidden"
    >
      <CardHeader className="px-3 py-1 max-[860px]:hidden">
        <CardTitle>
          <h2 className="text-xs font-semibold text-muted-foreground">浏览节点</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 max-[860px]:overflow-x-auto">
        <nav aria-label="社区节点">
          <div className="grid gap-0.5 max-[860px]:flex max-[860px]:w-max max-[860px]:min-w-full max-[860px]:gap-1">
            {nodes.map((node) => {
              const Icon = nodeIcons[node.icon];
              const isAll = node.id === "all";
              const isActive = node.id === activeNodeId;

              return (
                <Button
                  asChild
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 w-full justify-start px-2.5 text-[13px] max-[860px]:w-auto max-[860px]:shrink-0"
                  key={node.id}
                >
                  <Link
                    href={isAll ? "/" : `/nodes/${node.id}`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {isAll ? (
                      <Icon data-icon="inline-start" aria-hidden="true" />
                    ) : (
                      <span
                        className="mx-1 size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: node.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span>{node.name}</span>
                    <Badge
                      variant="outline"
                      className="ml-auto h-5 min-w-6 rounded-md px-1.5 text-[10px] tabular-nums"
                    >
                      {node.topicCount}
                    </Badge>
                  </Link>
                </Button>
              );
            })}
          </div>
        </nav>
      </CardContent>
    </Card>
  );
}

export function CommunityRightRail({
  account,
  overview,
  hotTopics,
  onlineMembers,
  sticky = true,
}: CommunityRightRailProps) {
  return (
    <div className={cn("grid gap-3", sticky && "sticky top-[calc(var(--header-height)+18px)]")}>
      <Card size="sm">
        <CardHeader className="border-b">
          <CardTitle>
            <h2>{account ? "账号状态" : "加入社区"}</h2>
          </CardTitle>
          {account?.emailVerified ? (
            <CardAction>
              <Badge variant="outline" className="rounded-md">
                已验证
              </Badge>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent>
          {account ? (
            <div className="grid gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar size="lg">
                  <AvatarImage src={account.image ?? undefined} alt={account.name} />
                  <AvatarFallback>{account.initials}</AvatarFallback>
                </Avatar>
                <div className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-sm font-medium">{account.name}</strong>
                  <span className="truncate text-xs text-muted-foreground">
                    @{account.username} · UID {account.uid}
                  </span>
                </div>
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link href="/account">
                  <ShieldCheck data-icon="inline-start" aria-hidden="true" />
                  账号中心
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Button asChild>
                <Link href="/auth/sign-in">
                  <LogIn data-icon="inline-start" aria-hidden="true" />
                  登录
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/auth/sign-up">
                  <UserPlus data-icon="inline-start" aria-hidden="true" />
                  注册
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b">
          <CardTitle>
            <h2>社区概览</h2>
          </CardTitle>
          <CardAction className="text-xs text-muted-foreground">今日</CardAction>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {overview.map((item) => (
              <div className="grid min-w-0 gap-0.5" key={item.label}>
                <dt className="order-2 text-xs text-muted-foreground">{item.label}</dt>
                <dd className="order-1 text-base font-semibold tabular-nums">{item.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b">
          <CardTitle>
            <h2>今日热议</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-0.5">
          {hotTopics.map((topic, index) => (
            <Button
              asChild
              variant="ghost"
              className="h-auto min-h-9 w-full justify-start px-1.5 py-1.5 whitespace-normal"
              key={topic.id}
            >
              <Link href={`/topics/${topic.id}`}>
                <Badge
                  variant="secondary"
                  className="size-5 shrink-0 rounded-md px-0 text-[10px] tabular-nums"
                >
                  {index + 1}
                </Badge>
                <span className="line-clamp-2 min-w-0 flex-1 text-left text-xs leading-[1.45]">
                  {topic.title}
                </span>
                <ArrowUpRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </Link>
            </Button>
          ))}
          {hotTopics.length === 0 ? (
            <p className="py-1 text-xs text-muted-foreground">暂无热议话题</p>
          ) : null}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b">
          <CardTitle>
            <h2>在线成员</h2>
          </CardTitle>
          <CardAction className="text-xs text-muted-foreground">
            {onlineMembers.length} 在线
          </CardAction>
        </CardHeader>
        <CardContent>
          {onlineMembers.length > 0 ? (
            <div className="flex flex-wrap gap-2" aria-label="在线成员">
              {onlineMembers.map((member) => (
                <Avatar key={member.name} title={member.name}>
                  <AvatarImage src={member.avatarUrl} alt={member.name} />
                  <AvatarFallback>{member.initials}</AvatarFallback>
                </Avatar>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <UsersRound className="size-4" aria-hidden="true" />
              <p>暂无在线成员</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
