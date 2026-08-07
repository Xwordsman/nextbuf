import { CommunityThreeColumnShell } from "@/components/community/community-three-column-shell.client";
import {
  CommunityNodeNavigation,
  CommunityRightRail,
} from "@/components/community/community-rails";
import { CommunityTopicFeed } from "@/components/community/community-topic-feed.client";
import type {
  CommunityFeedFilter,
  CommunityHomeView,
} from "@/modules/community/contracts/home-view";
import type { CurrentAccountView } from "@/modules/identity/session.server";

export function CommunityHomeShadcn({
  view,
  account,
  filter,
}: {
  view: CommunityHomeView;
  account: CurrentAccountView | null;
  filter: CommunityFeedFilter;
}) {
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
      <CommunityTopicFeed
        topics={view.topics}
        topicTotal={view.topicTotal}
        pagination={view.pagination}
        filter={filter}
      />
    </CommunityThreeColumnShell>
  );
}
