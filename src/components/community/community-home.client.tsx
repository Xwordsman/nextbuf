"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useCommunityUi } from "@/components/community/community-ui-provider.client";
import { RightRail } from "@/components/community/right-rail";
import { SideNavigation } from "@/components/community/side-navigation.client";
import { TopicList } from "@/components/community/topic-list";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardAction, CardHeader } from "@/components/shadcn/ui/card";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/shadcn/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shadcn/ui/tabs";
import type {
  CommunityFeedFilter,
  CommunityHomeView,
  CommunityNodeView,
} from "@/modules/community/contracts/home-view";
import type { CurrentAccountView } from "@/modules/identity/session.server";

export function CommunityHome({
  view,
  account,
  activeNode,
  filter,
}: {
  view: CommunityHomeView;
  account: CurrentAccountView | null;
  activeNode: CommunityNodeView | null;
  filter: CommunityFeedFilter;
}) {
  const { query, railOpen, setRailOpen } = useCommunityUi();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const visibleTopics = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return view.topics.filter(
      (topic) =>
        !normalized ||
        [topic.title, topic.nodeName, topic.authorName].some((value) =>
          value.toLocaleLowerCase("zh-CN").includes(normalized),
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
    const value = params.toString();
    return value ? `${pathname}?${value}` : pathname;
  };
  const rail = (
    <RightRail
      account={account}
      overview={view.overview}
      hotTopics={view.hotTopics}
      onlineMembers={view.onlineMembers}
    />
  );
  return (
    <main className="community-shell" data-testid="community-shell">
      <aside className="left-column">
        <SideNavigation nodes={view.nodes} activeNode={activeNode?.id ?? "all"} />
      </aside>
      <section className="main-column" aria-labelledby="topic-feed-title">
        <Tabs
          value={filter}
          onValueChange={(value) => router.push(feedHref(value as CommunityFeedFilter))}
          className="gap-3"
        >
          <Card size="sm" className="gap-0 py-0">
            <CardHeader className="min-h-12 items-center gap-3 rounded-t-xl border-b py-2.5 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
              <h1 id="topic-feed-title" className="sr-only">
                {activeNode?.name ?? "社区"}话题
              </h1>
              <TabsList variant="line" aria-label="话题筛选">
                <TabsTrigger value="latest">最新</TabsTrigger>
                <TabsTrigger value="hot">热门</TabsTrigger>
                <TabsTrigger value="essence">精华</TabsTrigger>
              </TabsList>
              <CardAction className="self-center">
                <span className="text-xs text-muted-foreground" aria-live="polite">
                  共 {query.trim() ? visibleTopics.length : view.topicTotal} 个话题
                </span>
              </CardAction>
            </CardHeader>
            <TabsContent value={filter} className="m-0">
              <TopicList topics={visibleTopics} />
            </TabsContent>
          </Card>
        </Tabs>
        <nav className="mt-3.5 flex items-center justify-center gap-1.5" aria-label="话题分页">
          <Button
            asChild={Boolean(view.pagination.previousCursor)}
            type="button"
            variant="outline"
            size="icon"
            disabled={!view.pagination.previousCursor}
            aria-label="上一页"
          >
            {view.pagination.previousCursor ? (
              <Link href={feedHref(filter, view.pagination.previousCursor, "previous")}>
                <ChevronLeft />
              </Link>
            ) : (
              <ChevronLeft />
            )}
          </Button>
          <Button type="button" size="sm" aria-current="page">
            1
          </Button>
          <Button
            asChild={Boolean(view.pagination.nextCursor)}
            type="button"
            variant="outline"
            size="icon"
            disabled={!view.pagination.nextCursor}
            aria-label="下一页"
          >
            {view.pagination.nextCursor ? (
              <Link href={feedHref(filter, view.pagination.nextCursor, "next")}>
                <ChevronRight />
              </Link>
            ) : (
              <ChevronRight />
            )}
          </Button>
        </nav>
      </section>
      <aside className="right-column" aria-label="社区侧栏">
        {rail}
      </aside>
      <Sheet open={railOpen} onOpenChange={setRailOpen}>
        <SheetContent
          side="right"
          className="z-[71] w-[min(360px,calc(100vw-24px))] gap-0 overflow-y-auto p-0"
          overlayClassName="z-[70]"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-3 right-3 z-10"
              aria-label="关闭"
            >
              <X />
            </Button>
          </SheetClose>
          <SheetHeader className="border-b pr-12">
            <SheetTitle>我的面板</SheetTitle>
          </SheetHeader>
          <div className="p-4">
            <RightRail
              account={account}
              overview={view.overview}
              hotTopics={view.hotTopics}
              onlineMembers={view.onlineMembers}
              sticky={false}
            />
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
