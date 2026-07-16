import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  FilePenLine,
  MessageCircle,
} from "lucide-react";
import { notFound } from "next/navigation";
import { MarkdownContent } from "@/components/community/markdown-content";
import { ReplyActions } from "@/components/community/reply-actions.client";
import { ReplyEditor } from "@/components/community/reply-editor.client";
import { PostLikeButton } from "@/components/interactions/post-like-button.client";
import { TopicActions } from "@/components/interactions/topic-actions.client";
import { TopicViewTracker } from "@/components/interactions/topic-view-tracker.client";
import { ReportDialog } from "@/components/moderation/report-dialog.client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { POST_BODY_MAX_LENGTH } from "@/modules/community/content-policy";
import { getPublicTopicTitle, getTopicPageView } from "@/modules/community/queries.server";

type TopicPageProps = {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
};

function topicNumber(value: string) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function replyFrom(value?: string | string[]) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(parsed) && parsed >= 2 ? parsed : 2;
}

export async function generateMetadata({ params }: TopicPageProps): Promise<Metadata> {
  const number = topicNumber((await params).number);
  if (!number) return { title: "主题不存在" };
  return { title: (await getPublicTopicTitle(number)) ?? "主题不存在" };
}

export default async function TopicPage({ params, searchParams }: TopicPageProps) {
  const number = topicNumber((await params).number);
  if (!number) notFound();
  const session = await getAuth().api.getSession({ headers: await headers() });
  const from = replyFrom((await searchParams).from);
  const topic = await getTopicPageView(number, session?.user.id, from);
  if (!topic) notFound();
  const statusLabel: Record<string, string> = {
    draft: "草稿",
    closed: "已关闭",
    hidden: "已隐藏",
    deleted: "已删除",
  };
  const isPublicTopic = ["published", "closed"].includes(topic.status);

  return (
    <main className="topic-page">
      <article className="topic-detail">
        {isPublicTopic ? (
          <TopicViewTracker
            topicNumber={topic.number}
            lastVisiblePosition={topic.lastVisiblePosition}
            markRead={topic.canInteract}
          />
        ) : null}
        <header className="topic-detail-head">
          <div className="topic-detail-node-line">
            <Link href={`/nodes/${topic.node.slug}`}>
              <span className="node-dot" style={{ backgroundColor: topic.node.color }} />
              {topic.node.name}
            </Link>
            <span>主题 #{topic.number}</span>
          </div>
          <div className="topic-detail-title-line">
            <h1>{topic.title}</h1>
            <div>
              {topic.isPinned ? <Badge variant="pinned">置顶</Badge> : null}
              {topic.isEssence ? <Badge variant="essence">精华</Badge> : null}
              {statusLabel[topic.status] ? <Badge>{statusLabel[topic.status]}</Badge> : null}
            </div>
          </div>
          <div className="topic-detail-meta">
            <span>
              <CalendarDays /> {topic.publishedAt?.toLocaleString("zh-CN") ?? "尚未发布"}
            </span>
            <span>
              <Eye /> {topic.viewCount} 浏览
            </span>
            <span>
              <MessageCircle /> {topic.replyCount} 回复
            </span>
            {topic.editedAt ? <span>首帖已编辑 {topic.revisionCount - 1} 次</span> : null}
          </div>
        </header>

        <div className="topic-detail-actions">
          {isPublicTopic ? (
            <TopicActions
              topicNumber={topic.number}
              initialBookmarked={topic.bookmarked}
              initialBookmarkCount={topic.bookmarkCount}
              initialFollowed={topic.followed}
              canInteract={topic.canInteract}
            />
          ) : null}
          {topic.canEdit ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/topics/${topic.number}/edit`}>
                <FilePenLine /> 编辑主题
              </Link>
            </Button>
          ) : null}
          {isPublicTopic ? (
            <ReportDialog
              target={{ type: "topic", number: topic.number }}
              signedIn={Boolean(session)}
              signInHref={`/auth/sign-in?next=/topics/${topic.number}`}
            />
          ) : null}
        </div>

        <Panel className="topic-post" id="post-1">
          <aside className="topic-post-author">
            <Avatar className="size-12">
              <AvatarImage src={topic.author.image ?? undefined} alt={topic.author.name} />
              <AvatarFallback>{topic.author.initials}</AvatarFallback>
            </Avatar>
            <Link href={`/u/${topic.author.username}`}>{topic.author.name}</Link>
            <span>@{topic.author.username}</span>
            <small>UID {topic.author.uid}</small>
          </aside>
          <div className="topic-post-main">
            <div className="post-floor-line">
              <span>#1</span>
              <time>{topic.createdAt.toLocaleString("zh-CN")}</time>
            </div>
            {topic.bodyHtml ? (
              <MarkdownContent html={topic.bodyHtml} />
            ) : (
              <p className="post-empty">该草稿尚未填写正文。</p>
            )}
            {isPublicTopic ? (
              <div className="reply-actions">
                <PostLikeButton
                  postId={topic.postId}
                  initialLiked={topic.liked}
                  initialCount={topic.likeCount}
                  canInteract={topic.canInteract}
                  signInHref={`/auth/sign-in?next=/topics/${topic.number}`}
                />
              </div>
            ) : null}
          </div>
        </Panel>

        <section className="topic-replies-section" aria-labelledby="topic-replies-title">
          <div className="topic-replies-head">
            <h2 id="topic-replies-title">回复</h2>
            <span>{topic.replyCount} 条有效回复</span>
          </div>
          {topic.replies.length > 0 ? (
            <div className="topic-reply-list">
              {topic.replies.map((reply) => (
                <Panel
                  className="topic-post reply-post"
                  id={`post-${reply.position}`}
                  key={reply.id}
                >
                  <aside className="topic-post-author">
                    <Avatar className="size-10">
                      <AvatarImage src={reply.author.image ?? undefined} alt={reply.author.name} />
                      <AvatarFallback>{reply.author.initials}</AvatarFallback>
                    </Avatar>
                    <Link href={`/u/${reply.author.username}`}>{reply.author.name}</Link>
                    <span>@{reply.author.username}</span>
                    <small>UID {reply.author.uid}</small>
                  </aside>
                  <div className="topic-post-main">
                    <div className="post-floor-line">
                      <Link href={`#post-${reply.position}`}>#{reply.position}</Link>
                      <time>{reply.createdAt.toLocaleString("zh-CN")}</time>
                    </div>
                    {reply.quote ? (
                      <blockquote className="reply-quote">
                        <Link href={`#post-${reply.quote.position}`}>
                          #{reply.quote.position} · {reply.quote.authorName}
                        </Link>
                        <p>{reply.quote.excerpt}</p>
                      </blockquote>
                    ) : null}
                    {reply.status === "deleted" ? (
                      <p className="reply-tombstone">该回复已删除，楼层号继续保留。</p>
                    ) : reply.bodyHtml ? (
                      <MarkdownContent html={reply.bodyHtml} />
                    ) : (
                      <p className="reply-tombstone">该回复暂不可见。</p>
                    )}
                    {reply.editedAt ? (
                      <p className="post-edited-label">已编辑 {reply.revisionCount - 1} 次</p>
                    ) : null}
                    <ReplyActions
                      topicNumber={topic.number}
                      position={reply.position}
                      authorName={reply.author.name}
                      body={reply.body}
                      quotedPosition={reply.quote?.position ?? null}
                      canQuote={topic.canReply && reply.status === "published"}
                      canEdit={reply.canEdit}
                      canDelete={reply.canDelete}
                      canRestore={reply.canRestore}
                      bodyMax={POST_BODY_MAX_LENGTH}
                      postId={reply.id}
                      liked={reply.liked}
                      likeCount={reply.likeCount}
                      canLike={topic.canInteract && reply.status === "published"}
                      signedIn={Boolean(session)}
                    />
                  </div>
                </Panel>
              ))}
            </div>
          ) : (
            <Panel className="topic-replies-empty">还没有回复。</Panel>
          )}
          {topic.replyPagination.previousFrom || topic.replyPagination.nextFrom ? (
            <nav className="reply-pagination" aria-label="回复分页">
              {topic.replyPagination.previousFrom ? (
                <Button asChild variant="outline">
                  <Link href={`/topics/${topic.number}?from=${topic.replyPagination.previousFrom}`}>
                    <ChevronLeft /> 上一页
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              {topic.replyPagination.nextFrom ? (
                <Button asChild variant="outline">
                  <Link href={`/topics/${topic.number}?from=${topic.replyPagination.nextFrom}`}>
                    下一页 <ChevronRight />
                  </Link>
                </Button>
              ) : null}
            </nav>
          ) : null}
        </section>

        {topic.canReply ? (
          <ReplyEditor
            topicNumber={topic.number}
            initialDraft={topic.replyDraft}
            bodyMax={POST_BODY_MAX_LENGTH}
          />
        ) : topic.status === "closed" ? (
          <Panel className="reply-locked">主题已经关闭，仅版主可以继续回复。</Panel>
        ) : !session ? (
          <Panel className="reply-locked">
            <Link href={`/auth/sign-in?next=/topics/${topic.number}`}>登录后参与讨论</Link>
          </Panel>
        ) : null}
      </article>
    </main>
  );
}
