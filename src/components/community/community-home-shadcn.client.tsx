"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import {
  ArrowUpRight,
  Bot,
  ChevronLeft,
  ChevronRight,
  Code2,
  Globe2,
  LayoutGrid,
  LogIn,
  MessageCircle,
  Network,
  Server,
  ShieldCheck,
  Sparkles,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { CommunityThreeColumnShell } from "@/components/community/community-three-column-shell.client";
import { useCommunityUi } from "@/components/community/community-ui-provider.client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/shadcn/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shadcn/ui/tabs";
import type {
  CommunityFeedFilter,
  CommunityHomeView,
  CommunityNodeIcon,
  CommunityNodeView,
  CommunityTopicStatus,
  CommunityTopicView,
  CommunityUserView,
} from "@/modules/community/contracts/home-view";
import type { CurrentAccountView } from "@/modules/identity/session.server";
import { cn } from "@/lib/utils";

const nodeIcons: Record<CommunityNodeIcon, LucideIcon> = {
  grid: LayoutGrid,
  bot: Bot,
  code: Code2,
  server: Server,
  globe: Globe2,
  network: Network,
  sparkles: Sparkles,
};

const topicStatusLabels: Record<CommunityTopicStatus, string> = {
  pinned: "置顶",
  hot: "热门",
  essence: "精华",
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

function HomeTopicList({ topics }: { topics: CommunityTopicView[] }) {
  if (topics.length === 0) {
    return (
      <div
        className="grid min-h-72 place-items-center content-center gap-1 px-6 py-12 text-center text-muted-foreground"
        aria-live="polite"
      >
        <MessageCircle className="mb-2 size-7" aria-hidden="true" />
        <h2 className="text-sm font-medium text-foreground">没有匹配的话题</h2>
        <p className="text-xs">换一个节点或搜索词再试。</p>
      </div>
    );
  }

  return (
    <div aria-label="话题列表">
      {topics.map((topic) => (
        <article
          className="grid min-h-20 grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-2.5 border-b px-3.5 py-3 transition-colors last:border-b-0 hover:bg-muted/40 max-[640px]:grid-cols-[36px_minmax(0,1fr)] max-[640px]:px-3"
          id={`topic-${topic.id}`}
          key={topic.id}
        >
          <Avatar className="size-9">
            <AvatarImage src={topic.authorAvatarUrl ?? undefined} alt={topic.authorName} />
            <AvatarFallback>{topic.authorInitials}</AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <div className="mb-1.5 flex min-w-0 items-start justify-between gap-2.5 max-[640px]:grid max-[640px]:gap-1.5">
              <h2 className="min-w-0 flex-1 text-sm leading-[1.45] font-medium break-words text-foreground">
                <Link
                  className="rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                  href={`/topics/${topic.id}`}
                >
                  {topic.title}
                </Link>
              </h2>
              {topic.isUnread || topic.statuses.length > 0 ? (
                <div
                  className="flex shrink-0 flex-wrap items-center justify-end gap-1 max-[640px]:justify-start"
                  aria-label="话题状态"
                >
                  {topic.isUnread ? (
                    <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-[10px]">
                      有新内容
                    </Badge>
                  ) : null}
                  {topic.statuses.map((status) => (
                    <Badge
                      key={status}
                      variant="outline"
                      className="h-5 rounded-md px-1.5 text-[10px]"
                    >
                      {topicStatusLabels[status]}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground">
              <Badge
                asChild
                variant="secondary"
                className="h-5 rounded-md px-1.5 text-[10px] font-medium"
              >
                <Link href={`/nodes/${topic.nodeId}`}>
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: topic.nodeColor }}
                    aria-hidden="true"
                  />
                  {topic.nodeName}
                </Link>
              </Badge>
              <Link
                className="font-medium text-foreground/75 outline-none hover:text-foreground hover:underline hover:underline-offset-4 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50"
                href={`/u/${topic.authorUsername}`}
              >
                {topic.authorName}
              </Link>
              <span aria-hidden="true">·</span>
              <span>{topic.createdLabel}</span>
              <span aria-hidden="true">·</span>
              <span data-testid="topic-views">{topic.views.toLocaleString("zh-CN")} 浏览</span>
              <span aria-hidden="true">·</span>
              <span data-testid="topic-last-reply">
                最后回复 {topic.lastReplyBy} · {topic.lastReplyLabel}
              </span>
            </div>
          </div>

          <Badge
            variant="secondary"
            className="h-7 min-w-14 self-center rounded-lg px-2 text-xs font-medium tabular-nums max-[640px]:col-start-2 max-[640px]:w-fit max-[640px]:self-start"
            aria-label={`${topic.replies} 条回复`}
          >
            <MessageCircle aria-hidden="true" />
            {topic.replies}
          </Badge>
        </article>
      ))}
    </div>
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

export function CommunityHomeShadcn({
  view,
  account,
  filter,
}: {
  view: CommunityHomeView;
  account: CurrentAccountView | null;
  filter: CommunityFeedFilter;
}) {
  const { query } = useCommunityUi();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const visibleTopics = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return view.topics.filter(
      (topic) =>
        !normalizedQuery ||
        [topic.title, topic.nodeName, topic.authorName].some((value) =>
          value.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
        ),
    );
  }, [query, view.topics]);

  const feedHref = (nextFilter: CommunityFeedFilter, cursor?: string, direction?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFilter === "latest") params.delete("filter");
    else params.set("filter", nextFilter);
    if (cursor) params.set("cursor", cursor);
    else params.delete("cursor");
    if (direction) params.set("direction", direction);
    else params.delete("direction");
    const queryString = params.toString();
    return queryString ? `${pathname}?${queryString}` : pathname;
  };

  const rightRailProps = {
    account,
    overview: view.overview,
    hotTopics: view.hotTopics,
    onlineMembers: view.onlineMembers,
  };

  return (
    <CommunityThreeColumnShell
      leftRail={<CommunityNodeNavigation nodes={view.nodes} />}
      rightRail={<CommunityRightRail {...rightRailProps} />}
      mobileRightRail={<CommunityRightRail {...rightRailProps} sticky={false} />}
      mainLabelledBy="topic-feed-title"
    >
      <Tabs
        value={filter}
        onValueChange={(value) => router.push(feedHref(value as CommunityFeedFilter))}
        className="gap-3"
      >
        <Card size="sm" className="gap-0 py-0">
          <CardHeader className="min-h-12 items-center gap-3 rounded-t-xl border-b py-2.5 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
            <h1 id="topic-feed-title" className="sr-only">
              社区话题
            </h1>
            <TabsList variant="line" aria-label="话题筛选">
              <TabsTrigger value="latest">最新</TabsTrigger>
              <TabsTrigger value="hot">热门</TabsTrigger>
              <TabsTrigger value="essence">精华</TabsTrigger>
            </TabsList>
            <CardAction className="self-center">
              <span
                className="text-xs text-muted-foreground"
                data-testid="topic-count"
                aria-live="polite"
              >
                共 {query.trim() ? visibleTopics.length : view.topicTotal} 个话题
              </span>
            </CardAction>
          </CardHeader>

          <TabsContent value={filter} className="m-0">
            <HomeTopicList topics={visibleTopics} />
          </TabsContent>
        </Card>
      </Tabs>

      <nav className="mt-3.5 flex items-center justify-center gap-1.5" aria-label="话题分页">
        {view.pagination.previousCursor ? (
          <Button asChild variant="outline" size="icon">
            <Link
              href={feedHref(filter, view.pagination.previousCursor, "previous")}
              aria-label="上一页"
            >
              <ChevronLeft />
            </Link>
          </Button>
        ) : (
          <Button type="button" variant="outline" size="icon" disabled aria-label="上一页">
            <ChevronLeft />
          </Button>
        )}
        <Button type="button" size="sm" aria-current="page">
          1
        </Button>
        {view.pagination.nextCursor ? (
          <Button asChild variant="outline" size="icon">
            <Link href={feedHref(filter, view.pagination.nextCursor, "next")} aria-label="下一页">
              <ChevronRight />
            </Link>
          </Button>
        ) : (
          <Button type="button" variant="outline" size="icon" disabled aria-label="下一页">
            <ChevronRight />
          </Button>
        )}
      </nav>
    </CommunityThreeColumnShell>
  );
}
