export type CommunityNodeIcon =
  "grid" | "bot" | "code" | "server" | "globe" | "network" | "sparkles";

export type CommunityNodeView = {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: CommunityNodeIcon;
  topicCount: number;
};

export type CommunityUserView = {
  name: string;
  username: string;
  uid: number;
  avatarUrl: string;
  initials: string;
  trustLevel: number;
  trustName: string;
  trustProgress: number;
  nextTrustLevel: number;
  joinedDays: number;
  topicCount: number;
  replyCount: number;
};

export type CommunityTopicStatus = "pinned" | "hot" | "essence";

export type CommunityTopicView = {
  id: number;
  title: string;
  nodeId: string;
  nodeName: string;
  nodeColor: string;
  authorName: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
  authorInitials: string;
  createdLabel: string;
  lastReplyLabel: string;
  lastReplyBy: string;
  views: number;
  replies: number;
  statuses: CommunityTopicStatus[];
};

export type CommunityFeedFilter = "latest" | "hot" | "essence";

export type CommunityPaginationView = {
  previousCursor: string | null;
  nextCursor: string | null;
};

export type CommunityNotificationView = {
  id: number;
  actorName: string;
  actorAvatarUrl: string;
  actorInitials: string;
  title: string;
  description: string;
  timeLabel: string;
  unread: boolean;
};

export type CommunityHomeView = {
  nodes: CommunityNodeView[];
  topics: CommunityTopicView[];
  topicTotal: number;
  hotTopics: CommunityTopicView[];
  pagination: CommunityPaginationView;
  overview: Array<{ label: string; value: string }>;
  onlineMembers: Array<Pick<CommunityUserView, "name" | "avatarUrl" | "initials">>;
};
