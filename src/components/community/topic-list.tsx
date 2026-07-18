import Link from "next/link";
import { MessageCircle } from "lucide-react";
import type {
  CommunityTopicStatus,
  CommunityTopicView,
} from "@/modules/community/contracts/home-view";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar";
import { Badge } from "@/components/shadcn/ui/badge";

const labels: Record<CommunityTopicStatus, string> = {
  pinned: "置顶",
  hot: "热门",
  essence: "精华",
};

export function TopicList({ topics }: { topics: CommunityTopicView[] }) {
  if (!topics.length)
    return (
      <div
        className="grid min-h-72 place-items-center gap-1 px-6 py-12 text-center text-muted-foreground"
        aria-live="polite"
      >
        <MessageCircle className="size-7" />
        <h2 className="text-sm font-medium text-foreground">没有匹配的话题</h2>
        <p className="text-xs">换一个节点或搜索词再试。</p>
      </div>
    );
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
              <h2 className="min-w-0 flex-1 text-sm leading-[1.45] font-medium break-words">
                <Link
                  className="rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                  href={`/topics/${topic.id}`}
                >
                  {topic.title}
                </Link>
              </h2>
              {topic.isUnread || topic.statuses.length ? (
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
                      {labels[status]}
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
                className="font-medium text-foreground/75 hover:text-foreground hover:underline"
                href={`/u/${topic.authorUsername}`}
              >
                {topic.authorName}
              </Link>
              <span aria-hidden="true">·</span>
              <span>{topic.createdLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{topic.views.toLocaleString("zh-CN")} 浏览</span>
              <span className="sm:ml-auto">
                最后回复 {topic.lastReplyBy} · {topic.lastReplyLabel}
              </span>
            </div>
          </div>
          <Badge
            variant="secondary"
            className="h-7 min-w-14 self-center rounded-lg px-2 text-xs font-medium tabular-nums max-[640px]:col-start-2 max-[640px]:w-fit max-[640px]:self-start"
            aria-label={`${topic.replies} 条回复`}
          >
            <MessageCircle />
            {topic.replies}
          </Badge>
        </article>
      ))}
    </div>
  );
}
