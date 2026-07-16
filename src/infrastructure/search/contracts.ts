export type SearchCategory = "all" | "topics" | "members" | "nodes";

export type TopicSearchResult = {
  kind: "topic";
  number: number;
  title: string;
  excerpt: string;
  nodeSlug: string;
  nodeName: string;
  authorUsername: string;
  authorName: string;
  replyCount: number;
  score: number;
};

export type MemberSearchResult = {
  kind: "member";
  username: string;
  name: string;
  image: string | null;
  bio: string;
  score: number;
};

export type NodeSearchResult = {
  kind: "node";
  slug: string;
  name: string;
  description: string;
  color: string;
  topicCount: number;
  score: number;
};

export type SearchResults = {
  topics: TopicSearchResult[];
  members: MemberSearchResult[];
  nodes: NodeSearchResult[];
};

export interface SearchProvider {
  search(input: { query: string; category: SearchCategory; limit: number }): Promise<SearchResults>;
}
