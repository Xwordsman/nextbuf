import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { queueAttachmentCollection } from "@/modules/community/attachments.server";
import { extractAttachmentIds, extractMentionUsernames } from "@/modules/community/content-policy";
import { CommunityError } from "@/modules/community/errors";

async function validateAttachments(
  transaction: Prisma.TransactionClient,
  input: {
    actorId: string;
    attachmentIds: string[];
    allowedPostId?: string;
  },
) {
  if (input.attachmentIds.length === 0) return [];
  const attachmentIds = [...input.attachmentIds].sort();
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "community_attachments"
      WHERE "id" IN (${Prisma.join(attachmentIds.map((id) => Prisma.sql`CAST(${id} AS uuid)`))})
      ORDER BY "id" FOR UPDATE`,
  );
  const attachments = await transaction.communityAttachment.findMany({
    where: { id: { in: attachmentIds } },
    include: { posts: { select: { postId: true } } },
  });
  if (attachments.length !== attachmentIds.length) {
    throw new CommunityError("invalid_attachment", 400);
  }
  for (const attachment of attachments) {
    const linkedElsewhere = attachment.posts.some(({ postId }) => postId !== input.allowedPostId);
    const alreadyOnPost = attachment.posts.some(({ postId }) => postId === input.allowedPostId);
    if (
      attachment.status === "failed" ||
      linkedElsewhere ||
      (attachment.uploaderId !== input.actorId && !alreadyOnPost)
    ) {
      throw new CommunityError("invalid_attachment", 400);
    }
  }
  return attachments;
}

async function markUnreferencedAttachments(
  transaction: Prisma.TransactionClient,
  attachmentIds: string[],
): Promise<void> {
  for (const attachmentId of attachmentIds) {
    const references = await transaction.communityAttachment.findUnique({
      where: { id: attachmentId },
      select: { _count: { select: { posts: true, revisions: true, drafts: true } } },
    });
    if (
      references &&
      references._count.posts + references._count.revisions + references._count.drafts === 0
    ) {
      await transaction.communityAttachment.update({
        where: { id: attachmentId },
        data: { orphanedAt: new Date() },
      });
      await queueAttachmentCollection(transaction, attachmentId, randomUUID());
    }
  }
}

export async function syncPostContentReferences(
  transaction: Prisma.TransactionClient,
  input: {
    actorId: string;
    postId: string;
    revisionId: string;
    body: string;
  },
): Promise<void> {
  const attachmentIds = extractAttachmentIds(input.body);
  const existing = await transaction.communityPostAttachment.findMany({
    where: { postId: input.postId },
    select: { attachmentId: true },
  });
  await validateAttachments(transaction, {
    actorId: input.actorId,
    attachmentIds,
    allowedPostId: input.postId,
  });
  await transaction.communityPostAttachment.deleteMany({ where: { postId: input.postId } });
  if (attachmentIds.length > 0) {
    await transaction.communityPostAttachment.createMany({
      data: attachmentIds.map((attachmentId) => ({ postId: input.postId, attachmentId })),
    });
    await transaction.communityRevisionAttachment.createMany({
      data: attachmentIds.map((attachmentId) => ({
        revisionId: input.revisionId,
        attachmentId,
      })),
    });
    await transaction.communityAttachment.updateMany({
      where: { id: { in: attachmentIds } },
      data: { orphanedAt: null },
    });
  }

  const mentionUsernames = extractMentionUsernames(input.body);
  const mentionedUsers =
    mentionUsernames.length > 0
      ? await transaction.user.findMany({
          where: { username: { in: mentionUsernames }, status: "active" },
          select: { id: true },
        })
      : [];
  await transaction.communityPostMention.deleteMany({ where: { postId: input.postId } });
  if (mentionedUsers.length > 0) {
    await transaction.communityPostMention.createMany({
      data: mentionedUsers.map(({ id }) => ({ postId: input.postId, mentionedUserId: id })),
    });
  }

  await markUnreferencedAttachments(
    transaction,
    existing
      .map(({ attachmentId }) => attachmentId)
      .filter((attachmentId) => !attachmentIds.includes(attachmentId)),
  );
}

export async function syncDraftAttachmentReferences(
  transaction: Prisma.TransactionClient,
  input: { actorId: string; draftId: string; body: string },
): Promise<void> {
  const attachmentIds = extractAttachmentIds(input.body);
  const existing = await transaction.communityPostDraftAttachment.findMany({
    where: { draftId: input.draftId },
    select: { attachmentId: true },
  });
  await validateAttachments(transaction, { actorId: input.actorId, attachmentIds });
  await transaction.communityPostDraftAttachment.deleteMany({ where: { draftId: input.draftId } });
  if (attachmentIds.length > 0) {
    await transaction.communityPostDraftAttachment.createMany({
      data: attachmentIds.map((attachmentId) => ({ draftId: input.draftId, attachmentId })),
    });
    await transaction.communityAttachment.updateMany({
      where: { id: { in: attachmentIds } },
      data: { orphanedAt: null },
    });
  }
  await markUnreferencedAttachments(
    transaction,
    existing
      .map(({ attachmentId }) => attachmentId)
      .filter((attachmentId) => !attachmentIds.includes(attachmentId)),
  );
}

export async function deletePostDraftWithReferences(
  transaction: Prisma.TransactionClient,
  draftId: string,
): Promise<void> {
  const attachments = await transaction.communityPostDraftAttachment.findMany({
    where: { draftId },
    select: { attachmentId: true },
  });
  await transaction.communityPostDraft.delete({ where: { id: draftId } });
  await markUnreferencedAttachments(
    transaction,
    attachments.map(({ attachmentId }) => attachmentId),
  );
}
