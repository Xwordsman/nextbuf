import Link from "next/link";
import { MessageCircle } from "lucide-react";
import type {
  CommunityTopicStatus,
  CommunityTopicView,
} from "@/modules/community/contracts/home-view";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";

const statusMeta: Record<
  CommunityTopicStatus,
  { label: string; variant: "pinned" | "hot" | "essence" }
> = {
  pinned: { label: "置顶", variant: "pinned" },
  hot: { label: "热门", variant: "hot" },
  essence: { label: "精华", variant: "essence" },
};

export function TopicList({ topics }: { topics: CommunityTopicView[] }) {
  if (topics.length === 0) {
    return (
      <Panel className="empty-state" aria-live="polite">
        <MessageCircle aria-hidden="true" />
        <h2>没有匹配的话题</h2>
        <p>换一个节点或搜索词再试。</p>
      </Panel>
    );
  }

  return (
    <Panel className="topic-list" aria-label="话题列表">
      {topics.map((topic) => (
        <article className="topic-item" id={`topic-${topic.id}`} key={topic.id}>
          <Avatar className="size-9">
            <AvatarImage src={topic.authorAvatarUrl ?? undefined} alt={topic.authorName} />
            <AvatarFallback>{topic.authorInitials}</AvatarFallback>
          </Avatar>

          <div className="topic-main">
            <div className="topic-title-row">
              <h2 className="topic-title">
                <Link href={`/topics/${topic.id}`}>{topic.title}</Link>
              </h2>
              {topic.statuses.length > 0 ? (
                <div className="topic-flags" aria-label="话题状态">
                  {topic.statuses.map((status) => (
                    <Badge key={status} variant={statusMeta[status].variant}>
                      {statusMeta[status].label}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="topic-subline">
              <Link className="topic-node" href={`/nodes/${topic.nodeId}`}>
                <span
                  className="node-dot"
                  style={{ backgroundColor: topic.nodeColor }}
                  aria-hidden="true"
                />
                {topic.nodeName}
              </Link>
              <Link className="topic-author" href={`/u/${topic.authorUsername}`}>
                {topic.authorName}
              </Link>
              <span className="meta-separator" aria-hidden="true" />
              <span>{topic.createdLabel}</span>
              <span className="meta-separator" aria-hidden="true" />
              <span>{topic.views.toLocaleString("zh-CN")} 浏览</span>
              <span className="last-reply">
                最后回复 {topic.lastReplyBy} · {topic.lastReplyLabel}
              </span>
            </div>
          </div>

          <div className="topic-replies" aria-label={`${topic.replies} 条回复`}>
            <MessageCircle aria-hidden="true" />
            {topic.replies}
          </div>
        </article>
      ))}
    </Panel>
  );
}
