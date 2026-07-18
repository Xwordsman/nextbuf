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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar";
import { Badge } from "@/components/shadcn/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/shadcn/ui/breadcrumb";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardContent } from "@/components/shadcn/ui/card";
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
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <article className="grid gap-4">
        {isPublicTopic ? (
          <TopicViewTracker
            topicNumber={topic.number}
            lastVisiblePosition={topic.lastVisiblePosition}
            markRead={topic.canInteract}
          />
        ) : null}
        <Card size="sm" className="gap-0 py-0">
          <CardContent className="grid gap-3 py-4">
            <header className="grid gap-3">
              <Breadcrumb>
                <BreadcrumbList className="text-xs">
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <Link
                        className="inline-flex items-center gap-1.5"
                        href={`/nodes/${topic.node.slug}`}
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: topic.node.color }}
                          aria-hidden="true"
                        />
                        {topic.node.name}
                      </Link>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>主题 #{topic.number}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="min-w-0 flex-1 text-xl font-semibold tracking-tight break-words sm:text-2xl">
                  {topic.title}
                </h1>
                <div className="flex flex-wrap gap-1" aria-label="主题状态">
                  {topic.isPinned ? (
                    <Badge variant="secondary" className="rounded-md">
                      置顶
                    </Badge>
                  ) : null}
                  {topic.isEssence ? (
                    <Badge variant="outline" className="rounded-md">
                      精华
                    </Badge>
                  ) : null}
                  {statusLabel[topic.status] ? (
                    <Badge variant="outline" className="rounded-md">
                      {statusLabel[topic.status]}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays /> {topic.publishedAt?.toLocaleString("zh-CN") ?? "尚未发布"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Eye /> {topic.viewCount} 浏览
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle /> {topic.replyCount} 回复
                </span>
                {topic.editedAt ? <span>首帖已编辑 {topic.revisionCount - 1} 次</span> : null}
              </div>
            </header>
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
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
          </CardContent>
        </Card>

        <Card size="sm" className="py-0" id="post-1">
          <CardContent className="grid gap-4 py-4 sm:grid-cols-[132px_minmax(0,1fr)]">
            <aside className="flex items-center gap-2 border-b pb-4 sm:flex-col sm:items-start sm:border-r sm:border-b-0 sm:pr-4 sm:pb-0">
              <Avatar className="size-12">
                <AvatarImage src={topic.author.image ?? undefined} alt={topic.author.name} />
                <AvatarFallback>{topic.author.initials}</AvatarFallback>
              </Avatar>
              <div className="grid gap-0.5">
                <Link
                  className="text-sm font-medium hover:underline"
                  href={`/u/${topic.author.username}`}
                >
                  {topic.author.name}
                </Link>
                <span className="text-xs text-muted-foreground">@{topic.author.username}</span>
                <small className="text-xs text-muted-foreground">UID {topic.author.uid}</small>
              </div>
            </aside>
            <div className="min-w-0">
              <div className="mb-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>#1</span>
                <time>{topic.createdAt.toLocaleString("zh-CN")}</time>
              </div>
              {topic.bodyHtml ? (
                <MarkdownContent html={topic.bodyHtml} />
              ) : (
                <p className="text-sm text-muted-foreground">该草稿尚未填写正文。</p>
              )}
              {isPublicTopic ? (
                <div className="mt-5 flex items-center gap-2 border-t pt-3">
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
          </CardContent>
        </Card>

        <section className="grid gap-3" aria-labelledby="topic-replies-title">
          <div className="flex items-center justify-between">
            <h2 id="topic-replies-title" className="text-sm font-medium">
              回复
            </h2>
            <span className="text-xs text-muted-foreground">{topic.replyCount} 条有效回复</span>
          </div>
          {topic.replies.length > 0 ? (
            <div className="grid gap-3">
              {topic.replies.map((reply) => (
                <Card size="sm" className="py-0" id={`post-${reply.position}`} key={reply.id}>
                  <CardContent className="grid gap-4 py-4 sm:grid-cols-[132px_minmax(0,1fr)]">
                    <aside className="flex items-center gap-2 border-b pb-4 sm:flex-col sm:items-start sm:border-r sm:border-b-0 sm:pr-4 sm:pb-0">
                      <Avatar className="size-10">
                        <AvatarImage
                          src={reply.author.image ?? undefined}
                          alt={reply.author.name}
                        />
                        <AvatarFallback>{reply.author.initials}</AvatarFallback>
                      </Avatar>
                      <div className="grid gap-0.5">
                        <Link
                          className="text-sm font-medium hover:underline"
                          href={`/u/${reply.author.username}`}
                        >
                          {reply.author.name}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          @{reply.author.username}
                        </span>
                        <small className="text-xs text-muted-foreground">
                          UID {reply.author.uid}
                        </small>
                      </div>
                    </aside>
                    <div className="min-w-0">
                      <div className="mb-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <Link href={`#post-${reply.position}`}>#{reply.position}</Link>
                        <time>{reply.createdAt.toLocaleString("zh-CN")}</time>
                      </div>
                      {reply.quote ? (
                        <blockquote
                          className="mb-4 rounded-md border-l-2 bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                          data-testid="reply-quote"
                        >
                          <Link href={`#post-${reply.quote.position}`}>
                            #{reply.quote.position} · {reply.quote.authorName}
                          </Link>
                          <p>{reply.quote.excerpt}</p>
                        </blockquote>
                      ) : null}
                      {reply.status === "deleted" ? (
                        <p className="text-sm text-muted-foreground">
                          该回复已删除，楼层号继续保留。
                        </p>
                      ) : reply.bodyHtml ? (
                        <MarkdownContent html={reply.bodyHtml} />
                      ) : (
                        <p className="text-sm text-muted-foreground">该回复暂不可见。</p>
                      )}
                      {reply.editedAt ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          已编辑 {reply.revisionCount - 1} 次
                        </p>
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
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card size="sm">
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                还没有回复。
              </CardContent>
            </Card>
          )}
          {topic.replyPagination.previousFrom || topic.replyPagination.nextFrom ? (
            <nav className="flex items-center justify-between" aria-label="回复分页">
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
          <Card size="sm">
            <CardContent className="py-4 text-sm text-muted-foreground">
              主题已经关闭，仅版主可以继续回复。
            </CardContent>
          </Card>
        ) : !session ? (
          <Card size="sm">
            <CardContent className="py-4 text-sm">
              <Link href={`/auth/sign-in?next=/topics/${topic.number}`}>登录后参与讨论</Link>
            </CardContent>
          </Card>
        ) : null}
      </article>
    </main>
  );
}
