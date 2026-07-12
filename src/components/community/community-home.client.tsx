"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { CommunityHomeView } from "@/modules/community/contracts/home-view";
import type { CurrentAccountView } from "@/modules/identity/session.server";
import { useCommunityUi } from "@/components/community/community-ui-provider.client";
import { RightRail } from "@/components/community/right-rail";
import { SideNavigation } from "@/components/community/side-navigation.client";
import { TopicList } from "@/components/community/topic-list";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TopicFilter = "latest" | "hot" | "essence";

export function CommunityHome({
  view,
  account,
}: {
  view: CommunityHomeView;
  account: CurrentAccountView | null;
}) {
  const { query, railOpen, setRailOpen } = useCommunityUi();
  const [activeNode, setActiveNode] = useState("all");
  const [filter, setFilter] = useState<TopicFilter>("latest");

  const visibleTopics = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return view.topics.filter((topic) => {
      const matchesNode = activeNode === "all" || topic.nodeId === activeNode;
      const matchesFilter =
        filter === "latest" ||
        (filter === "hot" && topic.statuses.includes("hot")) ||
        (filter === "essence" && topic.statuses.includes("essence"));
      const matchesQuery =
        !normalizedQuery ||
        [topic.title, topic.nodeName, topic.authorName].some((value) =>
          value.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
        );
      return matchesNode && matchesFilter && matchesQuery;
    });
  }, [activeNode, filter, query, view.topics]);

  return (
    <main className="community-shell" data-testid="community-shell">
      <aside className="left-column">
        <SideNavigation nodes={view.nodes} activeNode={activeNode} onNodeChange={setActiveNode} />
      </aside>

      <section className="main-column" aria-labelledby="topic-feed-title">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as TopicFilter)}>
          <div className="topic-toolbar">
            <div>
              <h1 id="topic-feed-title" className="sr-only">
                社区话题
              </h1>
              <TabsList aria-label="话题筛选">
                <TabsTrigger value="latest">最新</TabsTrigger>
                <TabsTrigger value="hot">热门</TabsTrigger>
                <TabsTrigger value="essence">精华</TabsTrigger>
              </TabsList>
            </div>
            <span className="topic-count" aria-live="polite">
              共 {visibleTopics.length} 个话题
            </span>
          </div>

          {(["latest", "hot", "essence"] as const).map((value) => (
            <TabsContent key={value} value={value} forceMount hidden={filter !== value}>
              {filter === value ? <TopicList topics={visibleTopics} /> : null}
            </TabsContent>
          ))}
        </Tabs>

        <nav className="pagination" aria-label="话题分页">
          <Button type="button" variant="outline" size="icon" disabled aria-label="上一页">
            <ChevronLeft />
          </Button>
          <Button type="button" size="sm" aria-current="page">
            1
          </Button>
          <Button type="button" variant="outline" size="sm" disabled>
            2
          </Button>
          <Button type="button" variant="outline" size="icon" disabled aria-label="下一页">
            <ChevronRight />
          </Button>
        </nav>
      </section>

      <aside className="right-column" aria-label="社区侧栏">
        <RightRail
          account={account}
          overview={view.overview}
          topics={view.topics}
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
              topics={view.topics}
              onlineMembers={view.onlineMembers}
            />
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
