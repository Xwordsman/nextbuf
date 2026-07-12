import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { CalendarDays, Eye, FilePenLine, MessageCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getTopicPageView } from "@/modules/community/queries.server";

type TopicPageProps = { params: Promise<{ number: string }> };

function topicNumber(value: string) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export async function generateMetadata({ params }: TopicPageProps): Promise<Metadata> {
  const number = topicNumber((await params).number);
  if (!number) return { title: "主题不存在" };
  const topic = await getTopicPageView(number);
  return { title: topic?.title ?? "主题不存在" };
}

export default async function TopicPage({ params }: TopicPageProps) {
  const number = topicNumber((await params).number);
  if (!number) notFound();
  const session = await getAuth().api.getSession({ headers: await headers() });
  const topic = await getTopicPageView(number, session?.user.id);
  if (!topic) notFound();
  const statusLabel: Record<string, string> = {
    draft: "草稿",
    closed: "已关闭",
    hidden: "已隐藏",
    deleted: "已删除",
  };

  return (
    <main className="topic-page">
      <article className="topic-detail">
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
            {topic.editedAt ? <span>已编辑 {topic.revisionCount - 1} 次</span> : null}
          </div>
        </header>
        <Panel className="topic-post">
          <aside className="topic-post-author">
            <Avatar className="size-12">
              <AvatarImage src={topic.author.image ?? undefined} alt={topic.author.name} />
              <AvatarFallback>{topic.author.initials}</AvatarFallback>
            </Avatar>
            <Link href={`/u/${topic.author.username}`}>{topic.author.name}</Link>
            <span>@{topic.author.username}</span>
            <small>UID {topic.author.uid}</small>
          </aside>
          <div className="topic-post-content">{topic.body || "该草稿尚未填写正文。"}</div>
        </Panel>
        {topic.canEdit ? (
          <div className="topic-detail-actions">
            <Button asChild variant="outline">
              <Link href={`/topics/${topic.number}/edit`}>
                <FilePenLine /> 编辑主题
              </Link>
            </Button>
          </div>
        ) : null}
      </article>
    </main>
  );
}
