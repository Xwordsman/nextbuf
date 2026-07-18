import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TopicEditor } from "@/components/community/topic-editor.client";
import { getAuth } from "@/infrastructure/auth/better-auth";
import {
  TOPIC_BODY_MAX_LENGTH,
  TOPIC_PUBLISH_BODY_MIN_LENGTH,
  TOPIC_PUBLISH_TITLE_MIN_LENGTH,
  TOPIC_TITLE_MAX_LENGTH,
} from "@/modules/community/contracts/topic-form";
import { listWritableNodes } from "@/modules/community/queries.server";

export const metadata = { title: "发布主题" };

export default async function NewTopicPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/topics/new");
  const nodes = await listWritableNodes();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">发布新主题</h1>
        <p className="text-sm text-muted-foreground">
          选择最准确的节点，标题写清问题，正文补充必要背景。
        </p>
      </header>
      <TopicEditor
        nodes={nodes}
        limits={{
          titleMax: TOPIC_TITLE_MAX_LENGTH,
          publishTitleMin: TOPIC_PUBLISH_TITLE_MIN_LENGTH,
          bodyMax: TOPIC_BODY_MAX_LENGTH,
          publishBodyMin: TOPIC_PUBLISH_BODY_MIN_LENGTH,
        }}
      />
    </main>
  );
}
