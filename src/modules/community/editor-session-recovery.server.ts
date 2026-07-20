import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { CommunityError } from "@/modules/community/errors";

export async function findTopicEditorSessionTarget(userId: string, editorSessionKey: string) {
  return getPrismaClient().communityTopic.findUnique({
    where: {
      authorId_editorSessionKey: {
        authorId: userId,
        editorSessionKey,
      },
    },
    select: {
      number: true,
      status: true,
      editorSessionRevision: true,
    },
  });
}

export async function findReplyEditorSessionTarget(
  userId: string,
  topicNumber: number,
  editorSessionKey: string,
) {
  const prisma = getPrismaClient();
  return prisma.$transaction(
    async (transaction) => {
      const session = await transaction.communityReplyEditorSession.findUnique({
        where: {
          authorId_key: {
            authorId: userId,
            key: editorSessionKey,
          },
        },
        include: {
          topic: { select: { number: true } },
          post: { select: { position: true, status: true } },
        },
      });
      if (!session) return null;
      if (session.topic.number !== topicNumber) {
        throw new CommunityError("editor_session_conflict", 409);
      }
      if (session.state === "superseded") {
        return {
          kind: "superseded" as const,
          editorSessionRevision: session.revision,
        };
      }
      if (session.state === "published") {
        if (!session.post || session.post.position === 1) {
          throw new CommunityError("editor_session_conflict", 409);
        }
        return {
          kind: "post" as const,
          position: session.post.position,
          status: session.post.status,
          editorSessionRevision: session.revision,
        };
      }
      const draft = await transaction.communityPostDraft.findUnique({
        where: { topicId_authorId: { topicId: session.topicId, authorId: userId } },
        select: { bodySource: true, editorSessionKey: true },
      });
      return {
        kind: "draft" as const,
        bodyPresent:
          session.state === "active" &&
          draft?.editorSessionKey === editorSessionKey &&
          draft.bodySource.length > 0,
        editorSessionRevision: session.revision,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
