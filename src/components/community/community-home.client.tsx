"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import type {
  CommunityFeedFilter,
  CommunityHomeView,
  CommunityNodeView,
} from "@/modules/community/contracts/home-view";
import type { CurrentAccountView } from "@/modules/identity/session.server";
import { useCommunityUi } from "@/components/community/community-ui-provider.client";
import { RightRail } from "@/components/community/right-rail";
import { SideNavigation } from "@/components/community/side-navigation.client";
import { TopicList } from "@/components/community/topic-list";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return view.topics.filter((topic) => {
      const matchesQuery =
        !normalizedQuery ||
        [topic.title, topic.nodeName, topic.authorName].some((value) =>
          value.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
        );
      return matchesQuery;
    });
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

  return (
    <main className="community-shell" data-testid="community-shell">
      <aside className="left-column">
        <SideNavigation nodes={view.nodes} activeNode={activeNode?.id ?? "all"} />
      </aside>

      <section className="main-column" aria-labelledby="topic-feed-title">
        {activeNode ? (
          <header className="node-feed-header">
            <span className="node-dot" style={{ backgroundColor: activeNode.color }} />
            <div>
              <h1>{activeNode.name}</h1>
              <p>{activeNode.description}</p>
            </div>
          </header>
        ) : null}
        <Tabs
          value={filter}
          onValueChange={(value) => router.push(feedHref(value as CommunityFeedFilter))}
        >
          <div className="topic-toolbar">
            <div>
              <h1 id="topic-feed-title" className={activeNode ? "sr-only" : "sr-only"}>
                社区话题
              </h1>
              <TabsList aria-label="话题筛选">
                <TabsTrigger value="latest">最新</TabsTrigger>
                <TabsTrigger value="hot">热门</TabsTrigger>
                <TabsTrigger value="essence">精华</TabsTrigger>
              </TabsList>
            </div>
            <span className="topic-count" aria-live="polite">
              共 {query.trim() ? visibleTopics.length : view.topicTotal} 个话题
            </span>
          </div>

          <TabsContent value={filter}>
            <TopicList topics={visibleTopics} />
          </TabsContent>
        </Tabs>

        <nav className="pagination" aria-label="话题分页">
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
      </section>

      <aside className="right-column" aria-label="社区侧栏">
        <RightRail
          account={account}
          overview={view.overview}
          hotTopics={view.hotTopics}
          onlineMembers={view.onlineMembers}
        />
      </aside>

      <Dialog open={railOpen} onOpenChange={setRailOpen}>
        <DialogContent className="mobile-rail-dialog">
          <DialogHeader>
            <DialogTitle>我的面板</DialogTitle>
          </DialogHeader>
          <div className="mobile-rail-body">
            <RightRail
              account={account}
              overview={view.overview}
              hotTopics={view.hotTopics}
              onlineMembers={view.onlineMembers}
            />
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
