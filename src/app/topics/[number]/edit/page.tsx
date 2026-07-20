import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { TopicEditor } from "@/components/community/topic-editor.client";
import { getAuth } from "@/infrastructure/auth/better-auth";
import {
  TOPIC_BODY_MAX_LENGTH,
  TOPIC_PUBLISH_BODY_MIN_LENGTH,
  TOPIC_PUBLISH_TITLE_MIN_LENGTH,
  TOPIC_TITLE_MAX_LENGTH,
} from "@/modules/community/contracts/topic-form";
import { CommunityError } from "@/modules/community/errors";
import { getTopicEditorView, listWritableNodes } from "@/modules/community/queries.server";

type EditTopicPageProps = { params: Promise<{ number: string }> };

export default async function EditTopicPage({ params }: EditTopicPageProps) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const rawNumber = (await params).number;
  if (!session) redirect(`/auth/sign-in?next=/topics/${rawNumber}/edit`);
  const number = Number(rawNumber);
  if (!Number.isSafeInteger(number) || number < 1) notFound();
  let topic;
  let writableNodes;
  try {
    [topic, writableNodes] = await Promise.all([
      getTopicEditorView(number, session.user.id),
      listWritableNodes(),
    ]);
  } catch (error) {
    if (error instanceof CommunityError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const nodes = writableNodes.some((node) => node.slug === topic.node.slug)
    ? writableNodes
    : [{ slug: topic.node.slug, name: topic.node.name }, ...writableNodes];
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">编辑主题 #{topic.number}</h1>
        <p className="text-sm text-muted-foreground">修改标题、节点或正文，并管理当前主题状态。</p>
      </header>
      <TopicEditor
        nodes={nodes}
        limits={{
          titleMax: TOPIC_TITLE_MAX_LENGTH,
          publishTitleMin: TOPIC_PUBLISH_TITLE_MIN_LENGTH,
          bodyMax: TOPIC_BODY_MAX_LENGTH,
          publishBodyMin: TOPIC_PUBLISH_BODY_MIN_LENGTH,
        }}
        topic={{
          number: topic.number,
          title: topic.title,
          body: topic.body,
          nodeSlug: topic.node.slug,
          status: topic.status,
          editorSessionKey: topic.editorSessionKey,
          editorSessionRevision: topic.editorSessionRevision,
          isClosed: topic.isClosed,
          isHidden: topic.isHidden,
          isPinned: topic.isPinned,
          isEssence: topic.isEssence,
          canModerate: topic.canModerate,
          revisions: topic.revisions.map((revision) => ({
            version: revision.version,
            source: revision.source,
            createdAt: revision.createdAt.toISOString(),
          })),
        }}
      />
    </main>
  );
}
