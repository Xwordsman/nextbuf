import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "@/cli/commands/setup";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { decryptMailPayload, encryptMailPayload } from "@/infrastructure/mail/encryption";
import { queueIdentityEmail } from "@/infrastructure/mail/queue";
import {
  ACCOUNT_DELETION_AVATAR_COLLECT_TOPIC,
  finalizeDueAccountDeletions,
  updateAccountDeletionRequest,
} from "@/modules/identity/account-deletion.server";
import { recordTopicView } from "@/modules/interactions/interactions.server";
import {
  getCurrentTopicViewViewerKeyHash,
  hashTopicViewViewerKey,
} from "@/modules/interactions/topic-view-identity.server";
import { processCommunityNotification } from "@/modules/notifications/worker.server";
import { resolvePublicProfile } from "@/modules/profiles/profile.server";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

const dayMs = 86_400_000;

function token(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

async function waitFor(assertion: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

async function createMember(label: string) {
  const suffix = token();
  return getPrismaClient().user.create({
    data: {
      name: `${label} ${suffix}`,
      username: `del_${label}_${suffix}`.slice(0, 24),
      email: `account-deletion+${label}-${suffix}@nextbuf.test`,
      emailVerified: true,
      status: "active",
      activatedAt: new Date(),
    },
  });
}

async function createNode() {
  const suffix = token();
  return getPrismaClient().communityNode.create({
    data: {
      slug: `deletion-${suffix}`,
      name: `Deletion ${suffix}`,
      description: "Account deletion integration fixture",
      color: "#334155",
      icon: "circle",
    },
  });
}

async function createTopicFixture(input: {
  authorId: string;
  nodeId: string;
  status: "draft" | "published";
}) {
  const now = new Date();
  const topic = await getPrismaClient().communityTopic.create({
    data: {
      authorId: input.authorId,
      nodeId: input.nodeId,
      title: `Account deletion ${input.status} ${token()}`,
      status: input.status,
      publishedAt: input.status === "published" ? now : null,
    },
  });
  const post = await getPrismaClient().communityPost.create({
    data: {
      topicId: topic.id,
      authorId: input.authorId,
      position: 1,
      status: input.status,
      bodySource: `Account deletion ${input.status} body`,
    },
  });
  const revision = await getPrismaClient().communityPostRevision.create({
    data: {
      postId: post.id,
      editorId: input.authorId,
      version: 1,
      title: topic.title,
      bodySource: post.bodySource,
      source: "create",
    },
  });
  return { topic, post, revision };
}

async function createAttachment(uploaderId: string, originalName: string) {
  const suffix = token();
  return getPrismaClient().communityAttachment.create({
    data: {
      uploaderId,
      storageDriver: "local",
      storageKey: `attachments/original/deletion/${suffix}.txt`,
      originalName,
      contentType: "text/plain",
      kind: "file",
      status: "ready",
      sizeBytes: 4,
      checksumSha256: "a".repeat(64),
    },
  });
}

describe("final account deletion", () => {
  beforeAll(async () => {
    await setup();
  });

  afterAll(async () => {
    await disconnectPrismaClient();
  });

  it("anonymizes a due account once while preserving public content and governance evidence", async () => {
    const prisma = getPrismaClient();
    const now = new Date();
    const [member, other, node] = await Promise.all([
      createMember("member"),
      createMember("other"),
      createNode(),
    ]);
    const original = {
      id: member.id,
      uid: member.uid,
      username: member.username,
      email: member.email,
    };
    const avatarUrl = `/api/media/avatars/${randomUUID()}.png`;
    await prisma.user.update({ where: { id: member.id }, data: { image: avatarUrl } });
    const [publicContent, privateContent, deletedPrivateContent, targetContent] = await Promise.all(
      [
        createTopicFixture({ authorId: member.id, nodeId: node.id, status: "published" }),
        createTopicFixture({ authorId: member.id, nodeId: node.id, status: "draft" }),
        createTopicFixture({ authorId: member.id, nodeId: node.id, status: "draft" }),
        createTopicFixture({ authorId: other.id, nodeId: node.id, status: "published" }),
      ],
    );
    await Promise.all([
      prisma.communityTopic.update({
        where: { id: deletedPrivateContent.topic.id },
        data: { status: "deleted", deletedFromStatus: "draft", deletedAt: now },
      }),
      prisma.communityPost.update({
        where: { id: deletedPrivateContent.post.id },
        data: { status: "deleted", deletedAt: now },
      }),
    ]);
    const [publicAttachment, privateAttachment, deletedPrivateAttachment, draftAttachment] =
      await Promise.all([
        createAttachment(member.id, "public.txt"),
        createAttachment(member.id, "private.txt"),
        createAttachment(member.id, "deleted-private.txt"),
        createAttachment(other.id, "draft-only.txt"),
      ]);
    const lateReply = await prisma.communityPost.create({
      data: {
        topicId: targetContent.topic.id,
        authorId: member.id,
        position: 2,
        status: "published",
        bodySource: "published reply retained after account deletion",
      },
    });
    await prisma.communityPostRevision.create({
      data: {
        postId: lateReply.id,
        editorId: member.id,
        version: 1,
        bodySource: lateReply.bodySource,
        source: "create",
      },
    });
    await prisma.communityTopic.update({
      where: { id: targetContent.topic.id },
      data: { replyCount: 1, nextPostPosition: 3 },
    });
    await prisma.communityPostAttachment.create({
      data: { postId: publicContent.post.id, attachmentId: publicAttachment.id },
    });
    await prisma.communityRevisionAttachment.create({
      data: { revisionId: publicContent.revision.id, attachmentId: publicAttachment.id },
    });
    await prisma.communityPostAttachment.create({
      data: { postId: privateContent.post.id, attachmentId: privateAttachment.id },
    });
    await prisma.communityRevisionAttachment.create({
      data: { revisionId: privateContent.revision.id, attachmentId: privateAttachment.id },
    });
    await prisma.communityPostAttachment.create({
      data: {
        postId: deletedPrivateContent.post.id,
        attachmentId: deletedPrivateAttachment.id,
      },
    });
    await prisma.communityRevisionAttachment.create({
      data: {
        revisionId: deletedPrivateContent.revision.id,
        attachmentId: deletedPrivateAttachment.id,
      },
    });
    const draft = await prisma.communityPostDraft.create({
      data: {
        topicId: targetContent.topic.id,
        authorId: member.id,
        bodySource: "private reply draft",
      },
    });
    await prisma.communityPostDraftAttachment.create({
      data: { draftId: draft.id, attachmentId: draftAttachment.id },
    });
    await prisma.communityReplyEditorSession.create({
      data: {
        topicId: targetContent.topic.id,
        authorId: member.id,
        key: randomUUID(),
        revision: 1,
      },
    });

    await prisma.interactionPostLike.create({
      data: { userId: member.id, postId: targetContent.post.id },
    });
    await prisma.communityPost.update({
      where: { id: targetContent.post.id },
      data: { likeCount: 1 },
    });
    await prisma.interactionTopicBookmark.create({
      data: { userId: member.id, topicId: targetContent.topic.id },
    });
    await prisma.communityTopic.update({
      where: { id: targetContent.topic.id },
      data: { bookmarkCount: 1 },
    });
    await prisma.interactionUserFollow.createMany({
      data: [
        { followerId: member.id, followedId: other.id },
        { followerId: other.id, followedId: member.id },
      ],
    });
    await prisma.interactionTopicFollow.create({
      data: { userId: member.id, topicId: targetContent.topic.id },
    });
    await prisma.interactionTopicReadState.create({
      data: { userId: member.id, topicId: targetContent.topic.id },
    });
    await prisma.communityPostMention.create({
      data: { postId: targetContent.post.id, mentionedUserId: member.id },
    });
    await recordTopicView({
      number: targetContent.topic.number,
      viewerId: member.id,
      anonymousFingerprint: "unused",
      now,
    });
    const viewerKey = `user:${member.id}`;
    const currentViewerKeyHash = getCurrentTopicViewViewerKeyHash(viewerKey);
    const previousTopicViewSecrets = getAuthEnvironment().TOPIC_VIEW_PREVIOUS_AUTH_SECRETS;
    if (previousTopicViewSecrets.length < 2) {
      throw new Error("At least two previous topic-view test secrets are required");
    }
    const previousViewerKeyHashes = previousTopicViewSecrets.map((secret) =>
      hashTopicViewViewerKey(viewerKey, secret),
    );
    const unrelatedViewerKeyHashes = [
      hashTopicViewViewerKey("anonymous:unrelated-deletion-fixture", previousTopicViewSecrets[0]!),
      getCurrentTopicViewViewerKeyHash(`user:${other.id}`),
    ];
    const currentView = await prisma.interactionTopicView.findFirstOrThrow({
      where: { topicId: targetContent.topic.id, viewerKeyHash: currentViewerKeyHash },
    });
    await prisma.interactionTopicView.createMany({
      data: [...previousViewerKeyHashes, ...unrelatedViewerKeyHashes].map((viewerKeyHash) => ({
        topicId: targetContent.topic.id,
        viewerKeyHash,
        bucketStartedAt: currentView.bucketStartedAt,
      })),
    });

    const receivedNotification = await prisma.notification.create({
      data: {
        recipientId: member.id,
        actorId: other.id,
        type: "reply",
        topicId: targetContent.topic.id,
        postId: targetContent.post.id,
        dedupeKey: `account-deletion-received:${token()}`,
        snapshot: { actorName: other.name, actorUsername: other.username },
      },
    });
    const outgoingNotification = await prisma.notification.create({
      data: {
        recipientId: other.id,
        actorId: member.id,
        type: "reply",
        topicId: publicContent.topic.id,
        postId: publicContent.post.id,
        dedupeKey: `account-deletion-outgoing:${token()}`,
        snapshot: { actorName: member.name, actorUsername: member.username },
      },
    });
    await prisma.notificationPreference.create({
      data: { userId: member.id, type: "reply", inAppEnabled: true, emailEnabled: true },
    });
    await prisma.account.create({
      data: {
        accountId: member.id,
        providerId: "credential",
        userId: member.id,
        password: "stored-password-hash",
      },
    });
    await prisma.session.create({
      data: {
        userId: member.id,
        token: `deletion-session-${token()}`,
        expiresAt: new Date(now.getTime() + dayMs),
      },
    });
    await prisma.verification.create({
      data: {
        identifier: "b".repeat(64),
        value: member.id,
        expiresAt: new Date(now.getTime() + dayMs),
      },
    });
    const oauthLinkVerification = await prisma.verification.create({
      data: {
        identifier: "d".repeat(64),
        value: JSON.stringify({ link: { userId: member.id, email: member.email } }),
        expiresAt: new Date(now.getTime() + dayMs),
      },
    });
    const uppercaseVerification = await prisma.verification.create({
      data: {
        identifier: "7".repeat(64),
        value: member.id.toUpperCase(),
        expiresAt: new Date(now.getTime() + dayMs),
      },
    });
    const escapedUserId = [...member.id]
      .map((character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
      .join("");
    const escapedLinkVerification = await prisma.verification.create({
      data: {
        identifier: "8".repeat(64),
        value: `{"link":{"userId":"${escapedUserId}"}}`,
        expiresAt: new Date(now.getTime() + dayMs),
      },
    });
    const privateMail = await prisma.emailDelivery.create({
      data: {
        kind: "password-reset",
        recipient: member.email,
        subject: "private mail",
        ciphertext: "ciphertext",
        initializationVector: "0".repeat(24),
        authTag: "0".repeat(32),
      },
    });
    const privateMailEvent = await prisma.outboxEvent.create({
      data: {
        topic: "nextbuf.identity.email.send",
        idempotencyKey: `account-deletion-mail:${privateMail.id}`,
        payload: { deliveryId: privateMail.id },
        lastError: `SMTP rejected ${member.email}`,
      },
    });
    const privateMailFailure = await prisma.workerJobFailure.create({
      data: {
        queueName: "nextbuf-system",
        jobId: `account-deletion-mail-${token()}`,
        jobName: "outbox-event",
        outboxEventId: privateMailEvent.id,
        emailDeliveryId: privateMail.id,
        attempts: 5,
        lastError: `SMTP rejected ${member.email}`,
      },
    });
    const outgoingNotificationPayload = encryptMailPayload({
      text: `Reply from ${member.name} (@${member.username})`,
      html: `<p>Reply from ${member.name} (@${member.username})</p>`,
    });
    const outgoingNotificationMail = await prisma.emailDelivery.create({
      data: {
        kind: "notification-reply",
        recipient: other.email,
        subject: `Reply from ${member.name}`,
        ...outgoingNotificationPayload,
      },
    });
    expect(decryptMailPayload(outgoingNotificationMail)).toMatchObject({
      text: expect.stringContaining(member.username),
      html: expect.stringContaining(member.name),
    });
    const outgoingNotificationDelivery = await prisma.notificationDelivery.create({
      data: {
        notificationId: outgoingNotification.id,
        channel: "email",
        status: "queued",
        emailDeliveryId: outgoingNotificationMail.id,
      },
    });
    const outgoingNotificationMailEvent = await prisma.outboxEvent.create({
      data: {
        topic: "nextbuf.mail.delivery.send",
        idempotencyKey: `account-deletion-notification-mail:${outgoingNotificationMail.id}`,
        payload: { deliveryId: outgoingNotificationMail.id },
        lastError: `SMTP rejected notification from ${member.username}`,
      },
    });
    const outgoingNotificationMailFailure = await prisma.workerJobFailure.create({
      data: {
        queueName: "nextbuf-system",
        jobId: `account-deletion-notification-mail-${token()}`,
        jobName: "outbox-event",
        outboxEventId: outgoingNotificationMailEvent.id,
        emailDeliveryId: outgoingNotificationMail.id,
        attempts: 5,
        lastError: `SMTP rejected notification from ${member.username}`,
      },
    });
    const bulkFactCount = 256;
    const bulkSuffix = token();
    const bulkPrivateTopics = Array.from({ length: bulkFactCount }, (_, index) => ({
      id: randomUUID(),
      authorId: member.id,
      nodeId: node.id,
      title: `Bulk private ${bulkSuffix} ${index}`,
      status: "draft",
    }));
    const bulkAttachments = Array.from({ length: bulkFactCount }, (_, index) => ({
      id: randomUUID(),
      uploaderId: member.id,
      storageDriver: "local",
      storageKey: `attachments/original/deletion/${bulkSuffix}-${index}.txt`,
      originalName: `private-${index}.txt`,
      contentType: "text/plain",
      kind: "file",
      status: "ready",
      sizeBytes: 4,
      checksumSha256: "b".repeat(64),
    }));
    const bulkDeliveries = Array.from({ length: bulkFactCount }, (_, index) => ({
      id: randomUUID(),
      kind: "password-reset",
      recipient: member.email,
      subject: `Bulk private mail ${bulkSuffix} ${index}`,
      ciphertext: "ciphertext",
      initializationVector: "0".repeat(24),
      authTag: "0".repeat(32),
    }));
    const bulkMailEvents = bulkDeliveries.map((delivery) => ({
      id: randomUUID(),
      topic: "nextbuf.identity.email.send",
      idempotencyKey: `account-deletion-bulk-mail:${bulkSuffix}:${delivery.id}`,
      payload: { deliveryId: delivery.id },
      lastError: "Mail dispatch failed",
    }));
    await prisma.communityTopic.createMany({ data: bulkPrivateTopics });
    await prisma.communityPost.createMany({
      data: bulkPrivateTopics.map((topic) => ({
        id: randomUUID(),
        topicId: topic.id,
        authorId: member.id,
        position: 1,
        status: "draft",
        bodySource: "Bulk private account deletion fixture",
      })),
    });
    await prisma.communityAttachment.createMany({ data: bulkAttachments });
    await prisma.emailDelivery.createMany({ data: bulkDeliveries });
    await prisma.outboxEvent.createMany({ data: bulkMailEvents });
    await prisma.workerJobFailure.createMany({
      data: bulkMailEvents.map((event, index) => ({
        queueName: "nextbuf-system",
        jobId: `account-deletion-bulk-mail-${bulkSuffix}-${index}`,
        jobName: "outbox-event",
        outboxEventId: event.id,
        emailDeliveryId: bulkDeliveries[index]!.id,
        attempts: 5,
        lastError: "Mail delivery failed",
      })),
    });
    await prisma.identityAuditEvent.create({
      data: {
        eventType: "identity.test.sensitive",
        userId: member.id,
        sessionId: randomUUID(),
        ipHash: "c".repeat(64),
        metadata: { email: member.email },
      },
    });
    const communityEvidence = await prisma.communityAuditEvent.create({
      data: {
        actorId: member.id,
        action: "deletion.test.evidence",
        topicId: privateContent.topic.id,
        postId: privateContent.post.id,
        requestId: `private-draft-${token()}`,
        metadata: { retained: true },
      },
    });
    const publicCommunityEvidence = await prisma.communityAuditEvent.create({
      data: {
        actorId: member.id,
        action: "deletion.test.public-evidence",
        topicId: publicContent.topic.id,
        postId: publicContent.post.id,
        requestId: `public-content-${token()}`,
        metadata: { email: member.email },
      },
    });
    const governanceEvidence = await prisma.governanceAuditEvent.create({
      data: {
        actorId: member.id,
        actorRoles: ["global_moderator"],
        action: "deletion.test.governance",
        targetType: "user",
        targetKey: member.id,
        reason: "integration fixture",
        beforeState: { status: "active" },
        afterState: { status: "active" },
        requestId: `deletion-${token()}`,
      },
    });
    await prisma.usernameAlias.create({
      data: { username: `old_${token()}`, userId: member.id },
    });
    await prisma.communityRoleAssignment.create({
      data: {
        userId: member.id,
        role: "admin",
        scopeKey: "site",
        grantedById: member.id,
      },
    });
    await expect(
      updateAccountDeletionRequest(member.id, "request", new Date(now.getTime() - 15 * dayMs)),
    ).rejects.toMatchObject({ code: "administrator_handover_required", status: 409 });
    await prisma.communityRoleAssignment.deleteMany({
      where: { userId: member.id, role: "admin", scopeKey: "site" },
    });
    await prisma.communityRoleAssignment.create({
      data: {
        userId: member.id,
        role: "global_moderator",
        scopeKey: "site",
        grantedById: member.id,
      },
    });
    const grantedRole = await prisma.communityRoleAssignment.create({
      data: {
        userId: other.id,
        role: "node_moderator",
        nodeId: node.id,
        scopeKey: node.id,
        grantedById: member.id,
      },
    });
    const moderationTargetKey = `user:${other.id}`;
    const moderationCase = await prisma.moderationCase.create({
      data: {
        targetType: "user",
        targetKey: moderationTargetKey,
        activeTargetKey: moderationTargetKey,
        reportedUserId: other.id,
        priorityScore: 1,
        summary: "account deletion governance evidence",
        createdById: member.id,
        assignedToId: member.id,
      },
    });
    const moderationReport = await prisma.moderationReport.create({
      data: {
        reporterId: member.id,
        caseId: moderationCase.id,
        targetType: "user",
        targetKey: moderationTargetKey,
        activeTargetKey: moderationTargetKey,
        reportedUserId: other.id,
        reason: "other",
        details: "account deletion governance evidence",
        reporterTrustLevel: 0,
        weight: 1,
        snapshot: { uid: other.uid, username: other.username, name: other.name },
      },
    });
    const moderationAction = await prisma.moderationAction.create({
      data: {
        caseId: moderationCase.id,
        actorId: member.id,
        actorRoles: ["global_moderator"],
        action: "warn",
        targetType: "user",
        targetKey: moderationTargetKey,
        targetUserId: other.id,
        reason: "account deletion governance evidence",
        beforeState: { warned: false },
        afterState: { warned: true },
        requestId: `account-deletion-action-${token()}`,
      },
    });
    const moderationSanction = await prisma.moderationSanction.create({
      data: {
        userId: other.id,
        type: "warning",
        caseId: moderationCase.id,
        actionId: moderationAction.id,
        reason: "account deletion governance evidence",
        createdById: member.id,
        revokedAt: now,
        revokedById: member.id,
        revocationReason: "account deletion governance evidence retained",
      },
    });
    const reportedMemberTargetKey = `user:${member.id}`;
    const reportedMemberCase = await prisma.moderationCase.create({
      data: {
        targetType: "user",
        targetKey: reportedMemberTargetKey,
        activeTargetKey: reportedMemberTargetKey,
        reportedUserId: member.id,
        priorityScore: 1,
        summary: "deleted account target evidence",
        createdById: other.id,
      },
    });
    const reportedMemberReport = await prisma.moderationReport.create({
      data: {
        reporterId: other.id,
        caseId: reportedMemberCase.id,
        targetType: "user",
        targetKey: reportedMemberTargetKey,
        activeTargetKey: reportedMemberTargetKey,
        reportedUserId: member.id,
        reason: "other",
        details: "deleted account target evidence",
        reporterTrustLevel: 0,
        weight: 1,
        snapshot: { uid: member.uid, username: member.username, name: member.name },
      },
    });
    const privatePostTargetKey = `post:${privateContent.post.id}`;
    const privatePostCase = await prisma.moderationCase.create({
      data: {
        targetType: "post",
        targetKey: privatePostTargetKey,
        activeTargetKey: privatePostTargetKey,
        topicId: privateContent.topic.id,
        postId: privateContent.post.id,
        priorityScore: 1,
        summary: "private draft governance evidence",
        createdById: other.id,
      },
    });
    const privatePostReport = await prisma.moderationReport.create({
      data: {
        reporterId: other.id,
        caseId: privatePostCase.id,
        targetType: "post",
        targetKey: privatePostTargetKey,
        activeTargetKey: privatePostTargetKey,
        topicId: privateContent.topic.id,
        postId: privateContent.post.id,
        reason: "privacy",
        details: "private draft governance evidence",
        reporterTrustLevel: 0,
        weight: 1,
        snapshot: { bodySource: privateContent.post.bodySource },
      },
    });
    const privatePostAction = await prisma.moderationAction.create({
      data: {
        caseId: privatePostCase.id,
        actorId: other.id,
        actorRoles: ["global_moderator"],
        action: "hide",
        targetType: "post",
        targetKey: privatePostTargetKey,
        topicId: privateContent.topic.id,
        postId: privateContent.post.id,
        reason: "private draft governance evidence",
        beforeState: { status: "draft" },
        afterState: { status: "hidden" },
        requestId: `account-deletion-private-post-${token()}`,
      },
    });
    const activeTrustRule = await prisma.trustRuleVersion.findFirstOrThrow({
      where: { status: "active" },
    });
    await expect(
      prisma.trustUserState.findUniqueOrThrow({ where: { userId: member.id } }),
    ).resolves.toMatchObject({ userId: member.id });
    const trustHistory = await prisma.trustLevelHistory.create({
      data: {
        userId: member.id,
        ruleVersionId: activeTrustRule.id,
        actorId: member.id,
        fromLevel: 0,
        toLevel: 1,
        automatedLevel: 1,
        source: "automatic",
        reason: { source: "account-deletion-integration" },
        metrics: { topics: 1 },
      },
    });

    const scheduledAt = await updateAccountDeletionRequest(
      member.id,
      "request",
      new Date(now.getTime() - 15 * dayMs),
    );
    expect(scheduledAt?.getTime()).toBeLessThan(now.getTime());
    const batches = await Promise.all([
      finalizeDueAccountDeletions(now),
      finalizeDueAccountDeletions(now),
    ]);
    expect(batches.reduce((sum, batch) => sum + batch.finalized, 0)).toBe(1);
    expect(batches.reduce((sum, batch) => sum + batch.failed, 0)).toBe(0);

    const deleted = await prisma.user.findUniqueOrThrow({ where: { id: original.id } });
    expect(deleted).toMatchObject({
      id: original.id,
      uid: original.uid,
      name: "已注销用户",
      status: "deleted",
      emailVerified: false,
      image: null,
      deletionRequestedAt: null,
      deletionScheduledAt: null,
      deletionFinalizedAt: now,
      deletionLastError: null,
    });
    expect(deleted.username).toMatch(/^deleted-/);
    expect(deleted.email).toBe(`deleted+${member.id}@deleted.invalid`);
    const originalAlias = await prisma.usernameAlias.findUniqueOrThrow({
      where: { username: original.username },
    });
    expect(originalAlias).toMatchObject({ userId: member.id });
    await expect(
      prisma.usernameAlias.update({
        where: { id: originalAlias.id },
        data: { username: `released_${token()}` },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.usernameAlias.update({
        where: { id: originalAlias.id },
        data: { userId: other.id },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.usernameAlias.delete({ where: { id: originalAlias.id } }),
    ).rejects.toBeDefined();
    await expect(resolvePublicProfile(original.username)).resolves.toMatchObject({
      redirected: true,
      user: {
        id: member.id,
        uid: original.uid,
        username: deleted.username,
        name: "已注销用户",
        status: "deleted",
        profile: null,
        trustState: null,
      },
    });
    await expect(resolvePublicProfile(deleted.username)).resolves.toMatchObject({
      redirected: false,
      user: { id: member.id, status: "deleted" },
    });

    await expect(
      prisma.communityTopic.findUnique({ where: { id: publicContent.topic.id } }),
    ).resolves.toMatchObject({ authorId: member.id, status: "published" });
    await expect(
      prisma.communityPost.findUnique({ where: { id: publicContent.post.id } }),
    ).resolves.toMatchObject({ authorId: member.id, position: 1, status: "published" });
    await expect(
      prisma.communityPostRevision.findUnique({ where: { id: publicContent.revision.id } }),
    ).resolves.toMatchObject({ editorId: member.id });
    await expect(
      prisma.communityPost.findUnique({ where: { id: lateReply.id } }),
    ).resolves.toMatchObject({ authorId: member.id, position: 2, status: "published" });
    await expect(
      prisma.$transaction((transaction) =>
        processCommunityNotification(transaction, { kind: "reply", postId: lateReply.id }),
      ),
    ).resolves.toEqual({ skipped: true });
    await expect(prisma.notification.count({ where: { postId: lateReply.id } })).resolves.toBe(0);
    await expect(
      prisma.communityTopic.findUnique({ where: { id: privateContent.topic.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.communityTopic.findUnique({ where: { id: deletedPrivateContent.topic.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.communityTopic.count({
        where: { authorId: member.id, title: { startsWith: `Bulk private ${bulkSuffix}` } },
      }),
    ).resolves.toBe(0);
    await expect(prisma.communityPostDraft.count({ where: { authorId: member.id } })).resolves.toBe(
      0,
    );
    await expect(
      prisma.communityReplyEditorSession.count({ where: { authorId: member.id } }),
    ).resolves.toBe(0);

    await expect(
      prisma.communityAttachment.findUnique({ where: { id: publicAttachment.id } }),
    ).resolves.toMatchObject({ originalName: "public.txt", orphanedAt: null });
    for (const attachmentId of [
      privateAttachment.id,
      deletedPrivateAttachment.id,
      draftAttachment.id,
    ]) {
      await expect(
        prisma.communityAttachment.findUnique({ where: { id: attachmentId } }),
      ).resolves.toMatchObject({ originalName: "deleted", orphanedAt: new Date(0) });
      await expect(
        prisma.outboxEvent.count({
          where: {
            idempotencyKey: `identity-deletion-attachment-collect:${member.id}:${attachmentId}`,
          },
        }),
      ).resolves.toBe(1);
    }
    await expect(
      prisma.communityAttachment.count({
        where: {
          storageKey: { startsWith: `attachments/original/deletion/${bulkSuffix}-` },
          originalName: "deleted",
          orphanedAt: new Date(0),
        },
      }),
    ).resolves.toBe(bulkFactCount);
    await expect(
      prisma.outboxEvent.count({
        where: {
          idempotencyKey: {
            startsWith: `identity-deletion-attachment-collect:${member.id}:`,
          },
        },
      }),
    ).resolves.toBe(bulkFactCount + 3);
    await expect(
      prisma.outboxEvent.count({
        where: {
          topic: ACCOUNT_DELETION_AVATAR_COLLECT_TOPIC,
          payload: { path: ["url"], equals: avatarUrl },
        },
      }),
    ).resolves.toBe(1);

    await expect(prisma.interactionPostLike.count({ where: { userId: member.id } })).resolves.toBe(
      0,
    );
    await expect(
      prisma.communityPost.findUniqueOrThrow({ where: { id: targetContent.post.id } }),
    ).resolves.toMatchObject({ likeCount: 0 });
    await expect(
      prisma.interactionTopicBookmark.count({ where: { userId: member.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.communityTopic.findUniqueOrThrow({ where: { id: targetContent.topic.id } }),
    ).resolves.toMatchObject({ bookmarkCount: 0 });
    await expect(
      prisma.interactionUserFollow.count({
        where: { OR: [{ followerId: member.id }, { followedId: member.id }] },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.interactionTopicFollow.count({ where: { userId: member.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.interactionTopicReadState.count({ where: { userId: member.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.communityPostMention.count({ where: { mentionedUserId: member.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.interactionTopicView.count({
        where: { viewerKeyHash: { in: [currentViewerKeyHash, ...previousViewerKeyHashes] } },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.interactionTopicView.count({
        where: { viewerKeyHash: { in: unrelatedViewerKeyHashes } },
      }),
    ).resolves.toBe(unrelatedViewerKeyHashes.length);

    await expect(
      prisma.notification.findUnique({ where: { id: receivedNotification.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.notification.findUniqueOrThrow({ where: { id: outgoingNotification.id } }),
    ).resolves.toMatchObject({
      actorId: null,
      snapshot: { actorName: "已注销用户", actorUsername: deleted.username },
    });
    await expect(
      prisma.emailDelivery.findUnique({ where: { id: outgoingNotificationMail.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.notificationDelivery.findUniqueOrThrow({
        where: { id: outgoingNotificationDelivery.id },
      }),
    ).resolves.toMatchObject({ status: "queued", emailDeliveryId: null });
    await expect(
      prisma.workerJobFailure.findUnique({ where: { id: outgoingNotificationMailFailure.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: outgoingNotificationMailEvent.id } }),
    ).resolves.toMatchObject({ lastError: null });
    await expect(
      prisma.emailDelivery.count({ where: { recipient: original.email } }),
    ).resolves.toBe(0);
    await expect(
      prisma.workerJobFailure.findUnique({ where: { id: privateMailFailure.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: privateMailEvent.id } }),
    ).resolves.toMatchObject({ lastError: null });
    await expect(
      prisma.outboxEvent.count({
        where: {
          idempotencyKey: { startsWith: `account-deletion-bulk-mail:${bulkSuffix}:` },
          lastError: null,
        },
      }),
    ).resolves.toBe(bulkFactCount);
    await expect(
      prisma.workerJobFailure.count({
        where: { jobId: { startsWith: `account-deletion-bulk-mail-${bulkSuffix}-` } },
      }),
    ).resolves.toBe(0);
    await expect(prisma.account.count({ where: { userId: member.id } })).resolves.toBe(0);
    await expect(prisma.session.count({ where: { userId: member.id } })).resolves.toBe(0);
    await expect(prisma.verification.count({ where: { value: member.id } })).resolves.toBe(0);
    await expect(
      prisma.verification.findUnique({ where: { id: oauthLinkVerification.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.verification.findUnique({ where: { id: uppercaseVerification.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.verification.findUnique({ where: { id: escapedLinkVerification.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.account.create({
        data: {
          accountId: `deleted-oauth-${token()}`,
          providerId: "github",
          userId: member.id,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.session.create({
        data: {
          userId: member.id,
          token: `deleted-session-${token()}`,
          expiresAt: new Date(now.getTime() + dayMs),
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.verification.create({
        data: {
          identifier: "e".repeat(64),
          value: member.id,
          expiresAt: new Date(now.getTime() + dayMs),
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.verification.create({
        data: {
          identifier: "f".repeat(64),
          value: JSON.stringify({ link: { userId: member.id, email: original.email } }),
          expiresAt: new Date(now.getTime() + dayMs),
        },
      }),
    ).rejects.toBeDefined();
    const unrelatedVerification = await prisma.verification.create({
      data: {
        identifier: "0".repeat(64),
        value: "unrelated-verification-value",
        expiresAt: new Date(now.getTime() + dayMs),
      },
    });
    await expect(
      prisma.verification.update({
        where: { id: unrelatedVerification.id },
        data: { value: member.id },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.verification.update({
        where: { id: unrelatedVerification.id },
        data: { value: JSON.stringify({ link: { userId: member.id } }) },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.verification.findUniqueOrThrow({ where: { id: unrelatedVerification.id } }),
    ).resolves.toMatchObject({ value: "unrelated-verification-value" });
    await expect(prisma.account.count({ where: { userId: member.id } })).resolves.toBe(0);
    await expect(prisma.session.count({ where: { userId: member.id } })).resolves.toBe(0);
    await expect(prisma.profile.findUnique({ where: { userId: member.id } })).resolves.toBeNull();
    await expect(
      prisma.user.update({ where: { id: member.id }, data: { name: "Resurrected profile" } }),
    ).rejects.toBeDefined();
    await expect(prisma.user.delete({ where: { id: member.id } })).rejects.toBeDefined();
    await expect(
      prisma.profile.create({ data: { userId: member.id, bio: "private data after deletion" } }),
    ).rejects.toBeDefined();
    await expect(
      prisma.notificationPreference.create({
        data: { userId: member.id, type: "reply", emailEnabled: true },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.interactionPostLike.create({
        data: { userId: member.id, postId: targetContent.post.id },
      }),
    ).rejects.toBeDefined();
    await expect(
      recordTopicView({
        number: targetContent.topic.number,
        viewerId: member.id,
        anonymousFingerprint: "unused-after-deletion",
      }),
    ).resolves.toEqual({ accepted: false });
    await queueIdentityEmail({
      userId: member.id,
      kind: "password-reset",
      recipient: original.email,
      subject: "must not be queued",
      text: "must not be queued",
      html: "<p>must not be queued</p>",
    });
    await expect(
      prisma.emailDelivery.count({ where: { recipient: original.email } }),
    ).resolves.toBe(0);
    await expect(
      prisma.communityRoleAssignment.count({ where: { userId: member.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.communityRoleAssignment.findUniqueOrThrow({ where: { id: grantedRole.id } }),
    ).resolves.toMatchObject({ grantedById: null });

    await expect(
      prisma.governanceAuditEvent.findUnique({ where: { id: governanceEvidence.id } }),
    ).resolves.toMatchObject({ actorId: member.id });
    await expect(
      prisma.moderationReport.findUniqueOrThrow({ where: { id: moderationReport.id } }),
    ).resolves.toMatchObject({
      reporterId: member.id,
      reportedUserId: other.id,
      caseId: moderationCase.id,
      details: "account deletion governance evidence",
      snapshot: expect.objectContaining({ username: other.username }),
    });
    await expect(
      prisma.moderationCase.findUniqueOrThrow({ where: { id: moderationCase.id } }),
    ).resolves.toMatchObject({
      createdById: member.id,
      assignedToId: null,
      reportedUserId: other.id,
      targetKey: moderationTargetKey,
    });
    await expect(
      prisma.moderationAction.findUniqueOrThrow({ where: { id: moderationAction.id } }),
    ).resolves.toMatchObject({
      actorId: member.id,
      targetUserId: other.id,
      caseId: moderationCase.id,
      beforeState: { warned: false },
      afterState: { warned: true },
      requestId: expect.stringContaining("account-deletion-action-"),
    });
    await expect(
      prisma.moderationSanction.findUniqueOrThrow({ where: { id: moderationSanction.id } }),
    ).resolves.toMatchObject({
      createdById: member.id,
      revokedById: member.id,
      userId: other.id,
      caseId: moderationCase.id,
      actionId: moderationAction.id,
      reason: "account deletion governance evidence",
    });
    await expect(
      prisma.moderationReport.findUniqueOrThrow({ where: { id: reportedMemberReport.id } }),
    ).resolves.toMatchObject({
      reporterId: other.id,
      reportedUserId: member.id,
      snapshot: expect.objectContaining({ username: original.username }),
    });
    await expect(
      prisma.moderationCase.findUniqueOrThrow({ where: { id: reportedMemberCase.id } }),
    ).resolves.toMatchObject({
      targetKey: reportedMemberTargetKey,
      reportedUserId: member.id,
    });
    await expect(
      prisma.moderationReport.findUniqueOrThrow({ where: { id: privatePostReport.id } }),
    ).resolves.toMatchObject({
      targetKey: privatePostTargetKey,
      topicId: null,
      postId: null,
      snapshot: { bodySource: privateContent.post.bodySource },
    });
    await expect(
      prisma.moderationCase.findUniqueOrThrow({ where: { id: privatePostCase.id } }),
    ).resolves.toMatchObject({ targetKey: privatePostTargetKey, topicId: null, postId: null });
    await expect(
      prisma.moderationAction.findUniqueOrThrow({ where: { id: privatePostAction.id } }),
    ).resolves.toMatchObject({
      targetKey: privatePostTargetKey,
      topicId: null,
      postId: null,
      actorId: other.id,
      beforeState: { status: "draft" },
      afterState: { status: "hidden" },
    });
    await expect(
      prisma.moderationCase.update({
        where: { id: privatePostCase.id },
        data: { postId: targetContent.post.id },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.trustLevelHistory.findUniqueOrThrow({ where: { id: trustHistory.id } }),
    ).resolves.toMatchObject({
      userId: member.id,
      actorId: member.id,
      ruleVersionId: activeTrustRule.id,
      reason: { source: "account-deletion-integration" },
      metrics: { topics: 1 },
    });
    await expect(
      prisma.trustUserState.findUnique({ where: { userId: member.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.moderationCase.update({
        where: { id: moderationCase.id },
        data: { assignedToId: member.id },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.communityAuditEvent.findUnique({ where: { id: communityEvidence.id } }),
    ).resolves.toMatchObject({
      actorId: member.id,
      topicId: null,
      postId: null,
      requestId: null,
      metadata: null,
    });
    await expect(
      prisma.communityAuditEvent.findUnique({ where: { id: publicCommunityEvidence.id } }),
    ).resolves.toMatchObject({
      actorId: member.id,
      topicId: publicContent.topic.id,
      postId: publicContent.post.id,
      requestId: null,
      metadata: null,
    });
    const identityEvidence = await prisma.identityAuditEvent.findMany({
      where: { userId: member.id },
    });
    expect(identityEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "identity.test.sensitive",
          sessionId: null,
          ipHash: null,
          metadata: null,
        }),
        expect.objectContaining({ eventType: "identity.deletion.finalized" }),
      ]),
    );
  });

  it("waits for an in-flight mail transaction without reversing the delivery and Outbox lock order", async () => {
    const prisma = getPrismaClient();
    const now = new Date();
    const member = await createMember("mail-lock");
    await updateAccountDeletionRequest(member.id, "request", new Date(now.getTime() - 30 * dayMs));
    const delivery = await prisma.emailDelivery.create({
      data: {
        kind: "password-reset",
        recipient: member.email,
        subject: "in-flight private mail",
        ciphertext: "ciphertext",
        initializationVector: "0".repeat(24),
        authTag: "0".repeat(32),
      },
    });
    const event = await prisma.outboxEvent.create({
      data: {
        topic: "nextbuf.identity.email.send",
        idempotencyKey: `account-deletion-in-flight-mail:${delivery.id}`,
        payload: { deliveryId: delivery.id },
        lastError: `SMTP pending for ${member.email}`,
      },
    });
    const failure = await prisma.workerJobFailure.create({
      data: {
        queueName: "nextbuf-system",
        jobId: `account-deletion-in-flight-mail-${token()}`,
        jobName: "outbox-event",
        outboxEventId: event.id,
        emailDeliveryId: delivery.id,
        attempts: 4,
        lastError: "Mail delivery failed",
      },
    });

    let signalDeliveryLocked!: () => void;
    let releaseMailTransaction!: () => void;
    const deliveryLocked = new Promise<void>((resolve) => {
      signalDeliveryLocked = resolve;
    });
    const mailTransactionRelease = new Promise<void>((resolve) => {
      releaseMailTransaction = resolve;
    });
    let sendAttempts = 0;
    const mailTransaction = prisma.$transaction(
      async (transaction) => {
        await transaction.emailDelivery.update({
          where: { id: delivery.id },
          data: { status: "sending", attempts: { increment: 1 }, lastError: null },
        });
        sendAttempts += 1;
        signalDeliveryLocked();
        await mailTransactionRelease;
        await transaction.emailDelivery.update({
          where: { id: delivery.id },
          data: { status: "sent", sentAt: new Date(), lastError: null },
        });
        await transaction.workerJobFailure.updateMany({
          where: { id: failure.id, resolvedAt: null },
          data: { resolvedAt: new Date() },
        });
        await transaction.$queryRaw`
          SELECT "id" FROM "outbox_events"
          WHERE "id" = ${event.id}::uuid
          FOR UPDATE
        `;
      },
      { timeout: 20_000 },
    );

    await deliveryLocked;
    const finalization = finalizeDueAccountDeletions(now);
    let result: Awaited<ReturnType<typeof finalizeDueAccountDeletions>> | undefined;
    try {
      await waitFor(async () => {
        const rows = await prisma.$queryRaw<Array<{ waiting: boolean }>>`
          SELECT EXISTS (
            SELECT 1
            FROM pg_stat_activity
            WHERE pid <> pg_backend_pid()
              AND datname = current_database()
              AND wait_event_type = 'Lock'
              AND query ILIKE '%email_deliveries%'
          ) AS "waiting"
        `;
        return rows[0]?.waiting === true;
      });
      releaseMailTransaction();
      [, result] = await Promise.all([mailTransaction, finalization]);
    } finally {
      releaseMailTransaction();
      await Promise.allSettled([mailTransaction, finalization]);
    }

    expect(result).toMatchObject({ claimed: 1, finalized: 1, failed: 0, skipped: 0 });
    expect(sendAttempts).toBe(1);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: member.id } }),
    ).resolves.toMatchObject({ status: "deleted", deletionFinalizedAt: now });
    await expect(
      prisma.emailDelivery.findUnique({ where: { id: delivery.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.workerJobFailure.findUnique({ where: { id: failure.id } }),
    ).resolves.toBeNull();
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toMatchObject({
      lastError: null,
    });
  });

  it("defers finalization while a committed SMTP claim has an unknown outcome", async () => {
    const prisma = getPrismaClient();
    const now = new Date();
    const member = await createMember("mail-claim");
    await updateAccountDeletionRequest(member.id, "request", new Date(now.getTime() - 30 * dayMs));
    const delivery = await prisma.emailDelivery.create({
      data: {
        kind: "password-reset",
        recipient: member.email,
        subject: "claimed private mail",
        ciphertext: "ciphertext",
        initializationVector: "0".repeat(24),
        authTag: "0".repeat(32),
        status: "sending",
        attempts: 1,
      },
    });

    await expect(finalizeDueAccountDeletions(now)).resolves.toEqual({
      claimed: 1,
      finalized: 0,
      failed: 1,
      skipped: 0,
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: member.id } }),
    ).resolves.toMatchObject({
      status: "active",
      deletionFinalizedAt: null,
      deletionLastError: "Account deletion is waiting for an unresolved email delivery outcome",
    });
    await expect(
      prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
    ).resolves.toMatchObject({ status: "sending" });

    await prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: "outcome_unknown", lastError: "Mail delivery failed (EOUTCOMEUNKNOWN)" },
    });
    const retryAt = new Date(Date.now() + 2 * 60_000);
    await expect(finalizeDueAccountDeletions(retryAt)).resolves.toEqual({
      claimed: 1,
      finalized: 0,
      failed: 1,
      skipped: 0,
    });
    await expect(
      prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
    ).resolves.toMatchObject({ status: "outcome_unknown" });

    await prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: "failed", lastError: "Mail delivery failed" },
    });
    const finalRetryAt = new Date(retryAt.getTime() + 2 * 60_000);
    await expect(finalizeDueAccountDeletions(finalRetryAt)).resolves.toEqual({
      claimed: 1,
      finalized: 1,
      failed: 0,
      skipped: 0,
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: member.id } }),
    ).resolves.toMatchObject({ status: "deleted", deletionFinalizedAt: finalRetryAt });
    await expect(
      prisma.emailDelivery.findUnique({ where: { id: delivery.id } }),
    ).resolves.toBeNull();
  });

  it("rejects incomplete deletion plans and retry state without an active request", async () => {
    const prisma = getPrismaClient();
    const member = await createMember("state");
    const now = new Date();

    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: { deletionScheduledAt: now },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: { deletionRequestedAt: now },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: {
          deletionAttemptCount: 1,
          deletionNextAttemptAt: new Date(now.getTime() + 60_000),
          deletionLastError: "orphaned retry",
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: { username: `deleted-${member.uid}` },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: { email: `deleted+${member.id}@deleted.invalid` },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.usernameAlias.create({
        data: { username: `deleted-${member.uid}`, userId: member.id },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: { username: `deleted_${member.uid}` },
      }),
    ).resolves.toMatchObject({ username: `deleted_${member.uid}` });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: member.id } }),
    ).resolves.toMatchObject({
      deletionRequestedAt: null,
      deletionScheduledAt: null,
      deletionAttemptCount: 0,
      deletionNextAttemptAt: null,
      deletionLastError: null,
    });
  });

  it("rejects a complete tombstone forged outside the finalization transaction", async () => {
    const prisma = getPrismaClient();
    const member = await createMember("forged");
    const now = new Date();
    await updateAccountDeletionRequest(member.id, "request", new Date(now.getTime() - 15 * dayMs));
    await prisma.usernameAlias.create({
      data: { username: member.username, userId: member.id },
    });

    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: {
          username: `deleted-${member.uid}`,
          name: "已注销用户",
          email: `deleted+${member.id}@deleted.invalid`,
          emailVerified: false,
          image: null,
          status: "deleted",
          activatedAt: null,
          usernameChangedAt: null,
          deletionRequestedAt: null,
          deletionScheduledAt: null,
          deletionFinalizedAt: now,
          deletionNextAttemptAt: null,
          deletionLastError: null,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: member.id } }),
    ).resolves.toMatchObject({
      status: "active",
      deletionFinalizedAt: null,
    });
    await updateAccountDeletionRequest(member.id, "cancel", now);
  });

  it("requires exact canonical tombstones and preserves immutable identity during finalization", async () => {
    const prisma = getPrismaClient();
    const member = await createMember("canonical");
    const now = new Date();
    await updateAccountDeletionRequest(member.id, "request", new Date(now.getTime() - 15 * dayMs));
    await prisma.usernameAlias.create({
      data: { username: member.username, userId: member.id },
    });
    const claimExpiresAt = new Date(now.getTime() + 5 * 60_000);
    await prisma.user.update({
      where: { id: member.id },
      data: { deletionAttemptCount: 1, deletionNextAttemptAt: claimExpiresAt },
    });

    const tombstone = {
      username: `deleted-${member.uid}`,
      name: "已注销用户",
      email: `deleted+${member.id}@deleted.invalid`,
      emailVerified: false,
      image: null,
      status: "deleted",
      activatedAt: null,
      usernameChangedAt: null,
      deletionRequestedAt: null,
      deletionScheduledAt: null,
      deletionFinalizedAt: now,
      deletionNextAttemptAt: null,
      deletionLastError: null,
    } as const;

    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: {
          ...tombstone,
          username: `Deleted-${member.uid}`,
          email: `DELETED+${member.id}@DELETED.INVALID`,
        },
      }),
    ).rejects.toBeDefined();

    const changedId = randomUUID();
    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: {
          ...tombstone,
          id: changedId,
          email: `deleted+${changedId}@deleted.invalid`,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: {
          ...tombstone,
          uid: member.uid + 1_000_000,
          username: `deleted-${member.uid + 1_000_000}`,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: { ...tombstone, createdAt: new Date(member.createdAt.getTime() - dayMs) },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.user.update({
        where: { id: member.id },
        data: { ...tombstone, deletionAttemptCount: 2 },
      }),
    ).rejects.toBeDefined();

    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: member.id } }),
    ).resolves.toMatchObject({
      id: member.id,
      uid: member.uid,
      createdAt: member.createdAt,
      status: "active",
      deletionAttemptCount: 1,
      deletionFinalizedAt: null,
      deletionNextAttemptAt: claimExpiresAt,
    });
    await updateAccountDeletionRequest(member.id, "cancel", now);
  });

  it("persists a failed finalization and retries it after administrator handover", async () => {
    const prisma = getPrismaClient();
    const now = new Date();
    const member = await createMember("retry");
    await updateAccountDeletionRequest(member.id, "request", new Date(now.getTime() - 15 * dayMs));
    await prisma.communityRoleAssignment.create({
      data: { userId: member.id, role: "admin", scopeKey: "site" },
    });

    await expect(finalizeDueAccountDeletions(now)).resolves.toMatchObject({
      claimed: 1,
      finalized: 0,
      failed: 1,
    });
    const failed = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(failed).toMatchObject({
      status: "active",
      deletionAttemptCount: 1,
      deletionLastError: "administrator_handover_required",
      deletionNextAttemptAt: expect.any(Date),
    });
    await expect(finalizeDueAccountDeletions(now)).resolves.toMatchObject({ claimed: 0 });

    await prisma.communityRoleAssignment.deleteMany({
      where: { userId: member.id, role: "admin", scopeKey: "site" },
    });
    const retryAt = new Date((failed.deletionNextAttemptAt?.getTime() ?? now.getTime()) + 1);
    await expect(finalizeDueAccountDeletions(retryAt)).resolves.toMatchObject({
      claimed: 1,
      finalized: 1,
      failed: 0,
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: member.id } }),
    ).resolves.toMatchObject({
      status: "deleted",
      deletionAttemptCount: 2,
      deletionFinalizedAt: retryAt,
      deletionLastError: null,
    });
  });
});
