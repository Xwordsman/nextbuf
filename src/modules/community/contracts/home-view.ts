export type CommunityNodeIcon =
  "grid" | "bot" | "code" | "server" | "globe" | "network" | "sparkles";

export type CommunityNodeView = {
  id: string;
  name: string;
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
  authorAvatarUrl: string;
  authorInitials: string;
  createdLabel: string;
  lastReplyLabel: string;
  lastReplyBy: string;
  views: number;
  replies: number;
  statuses: CommunityTopicStatus[];
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
  overview: Array<{ label: string; value: string }>;
  onlineMembers: Array<Pick<CommunityUserView, "name" | "avatarUrl" | "initials">>;
};
