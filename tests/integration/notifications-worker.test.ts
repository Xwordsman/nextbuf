import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "@/cli/commands/setup";
import { disconnectRedisClient, getRedisClient } from "@/infrastructure/cache/redis";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { queueIdentityEmail } from "@/infrastructure/mail/queue";
import { dispatchOutboxBatch } from "@/infrastructure/outbox/dispatcher";
import {
  OUTBOX_JOB_NAME,
  SYSTEM_QUEUE_NAME,
  type OutboxJobData,
} from "@/infrastructure/queue/contracts";
import { closeSystemQueue, getSystemQueue } from "@/infrastructure/queue/system-queue";
import { createReply } from "@/modules/community/replies.server";
import { createTopic } from "@/modules/community/topics.server";
import { setTopicFollowed } from "@/modules/interactions/interactions.server";
import { updateNotificationPreferences } from "@/modules/notifications/notifications.server";
import { createOutboxEvent } from "@/infrastructure/outbox/create-event";
import { createOutboxWorker } from "@/worker/processors/outbox";
import { WORKER_MAINTENANCE_TASK } from "@/worker/contracts";
import { processReplayRequests, requestWorkerReplay } from "@/worker/failures.server";
import { runScheduledTasks } from "@/worker/scheduler.server";

const emailPrefix = "notifications-integration+";
const emailDomain = "@nextbuf.test";

async function actor(name: string) {
  const suffix = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  return getPrismaClient().user.create({
    data: {
      name,
      username: `nt_${suffix}`.slice(0, 24),
      email: `${emailPrefix}${suffix}${emailDomain}`,
      emailVerified: true,
      status: "active",
      activatedAt: new Date(),
    },
  });
}

async function waitFor(assertion: () => Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

describe("notifications, mail and Worker recovery integration", () => {
  beforeAll(async () => {
    await setup();
    const prisma = getPrismaClient();
    const users = await prisma.user.findMany({
      where: { email: { startsWith: emailPrefix, endsWith: emailDomain } },
      select: { id: true },
    });
    const ids = users.map(({ id }) => id);
    await prisma.communityTopic.deleteMany({ where: { authorId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.outboxEvent.deleteMany({
      where: {
        OR: [
          { idempotencyKey: { startsWith: "notification-" } },
          { idempotencyKey: { startsWith: "mail-delivery:" } },
          { idempotencyKey: { startsWith: "notifications-test:" } },
        ],
      },
    });
    await prisma.emailDelivery.deleteMany({
      where: { recipient: { startsWith: emailPrefix, endsWith: emailDomain } },
    });
  });

  afterAll(async () => {
    await closeSystemQueue();
    await disconnectRedisClient();
    await disconnectPrismaClient();
  });

  it("recovers reply notification intent after Redis loss and applies recipient precedence", async () => {
    const prisma = getPrismaClient();
    const [author, replier, mentioned, follower] = await Promise.all([
      actor("Author"),
      actor("Replier"),
      actor("Mentioned"),
      actor("Follower"),
    ]);
    const topic = await createTopic(
      { userId: author.id },
      {
        nodeSlug: "ai",
        title: "通知优先级与 Outbox 恢复验证主题",
        body: "该主题用于验证回复、提及和关注主题通知的稳定去重。",
        action: "publish",
      },
    );
    await Promise.all([
      setTopicFollowed(mentioned.id, topic.number, true),
      setTopicFollowed(follower.id, topic.number, true),
    ]);
    await updateNotificationPreferences(mentioned.id, [
      { type: "mention", inAppEnabled: true, emailEnabled: true },
      { type: "reply", inAppEnabled: true, emailEnabled: false },
      { type: "followed_topic_reply", inAppEnabled: true, emailEnabled: false },
      { type: "management", inAppEnabled: true, emailEnabled: false },
    ]);
    const reply = await createReply({ userId: replier.id }, topic.number, {
      body: `这是通知恢复测试回复，@${mentioned.username} 同时也是主题关注者。`,
    });
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { idempotencyKey: `notification-reply:${reply.id}` },
    });
    expect(await prisma.notification.count({ where: { postId: reply.id } })).toBe(0);

    await getRedisClient().flushdb();
    const worker = createOutboxWorker();
    await worker.worker.waitUntilReady();
    await expect(dispatchOutboxBatch("notification-integration")).resolves.toMatchObject({
      dispatched: expect.any(Number),
    });
    await waitFor(async () =>
      Boolean(
        await prisma.processedJob.findUnique({
          where: {
            queueName_idempotencyKey: {
              queueName: SYSTEM_QUEUE_NAME,
              idempotencyKey: `outbox-${event.id}`,
            },
          },
        }),
      ),
    );
    await worker.worker.close();
    if (worker.connection.status !== "end") await worker.connection.quit();

    const notifications = await prisma.notification.findMany({
      where: { postId: reply.id },
      include: { deliveries: true },
    });
    expect(notifications).toHaveLength(3);
    expect(notifications.find(({ recipientId }) => recipientId === mentioned.id)?.type).toBe(
      "mention",
    );
    expect(notifications.find(({ recipientId }) => recipientId === author.id)?.type).toBe("reply");
    expect(notifications.find(({ recipientId }) => recipientId === follower.id)?.type).toBe(
      "followed_topic_reply",
    );
    expect(notifications.some(({ recipientId }) => recipientId === replier.id)).toBe(false);
    await expect(
      prisma.emailDelivery.count({
        where: { recipient: mentioned.email, kind: "notification-mention" },
      }),
    ).resolves.toBe(1);
  });

  it("keeps security mail independent from ordinary notification preferences", async () => {
    const member = await actor("Security Mail");
    await updateNotificationPreferences(
      member.id,
      ["mention", "reply", "followed_topic_reply", "management"].map((type) => ({
        type: type as "mention" | "reply" | "followed_topic_reply" | "management",
        inAppEnabled: false,
        emailEnabled: false,
      })),
    );
    await queueIdentityEmail({
      kind: "password-reset",
      recipient: member.email,
      subject: "安全邮件隔离测试",
      text: "安全邮件不会被普通通知偏好关闭。",
      html: "<p>安全邮件不会被普通通知偏好关闭。</p>",
    });
    await expect(
      getPrismaClient().emailDelivery.count({
        where: { recipient: member.email, kind: "password-reset", status: "pending" },
      }),
    ).resolves.toBe(1);
  });

  it("persists final failures and turns replay requests back into publishable Outbox events", async () => {
    const prisma = getPrismaClient();
    const operator = await actor("Replay Operator");
    const event = await createOutboxEvent(prisma, {
      topic: "nextbuf.test.replay",
      idempotencyKey: `notifications-test:replay:${Date.now()}`,
      payload: { source: "replay-test" },
    });
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
    const data: OutboxJobData = {
      eventId: event.id,
      topic: event.topic,
      version: event.version,
      payload: { source: "replay-test" },
    };
    const worker = createOutboxWorker();
    await worker.worker.waitUntilReady();
    await getSystemQueue().add(OUTBOX_JOB_NAME, data, { jobId: event.id, attempts: 1 });
    await waitFor(async () =>
      Boolean(
        await prisma.workerJobFailure.findUnique({
          where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
        }),
      ),
    );
    await worker.worker.close();
    if (worker.connection.status !== "end") await worker.connection.quit();
    const failure = await prisma.workerJobFailure.findUniqueOrThrow({
      where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
    });
    expect(failure.lastError).toContain("No worker handler registered");
    await expect(requestWorkerReplay(failure.id, operator.id)).resolves.toBe(true);
    await expect(processReplayRequests()).resolves.toBeGreaterThanOrEqual(1);
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toMatchObject({
      publishedAt: null,
      lockedAt: null,
    });
    await expect(
      prisma.workerJobFailure.findUniqueOrThrow({ where: { id: failure.id } }),
    ).resolves.toMatchObject({
      replayCount: 1,
      replayedAt: expect.any(Date),
    });
    await prisma.workerJobFailure.delete({ where: { id: failure.id } });
    await prisma.outboxEvent.delete({ where: { id: event.id } });
  });

  it("allows only one Worker to claim the same scheduled run", async () => {
    const prisma = getPrismaClient();
    const before = await prisma.workerScheduledTask.update({
      where: { name: WORKER_MAINTENANCE_TASK },
      data: { nextRunAt: new Date(0), lockedAt: null, lockOwner: null },
    });
    const now = new Date();
    const results = await Promise.all([
      runScheduledTasks("scheduler-a", now),
      runScheduledTasks("scheduler-b", now),
    ]);
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(1);
    await expect(
      prisma.workerScheduledTask.findUniqueOrThrow({ where: { name: WORKER_MAINTENANCE_TASK } }),
    ).resolves.toMatchObject({ runCount: before.runCount + 1, lockedAt: null, lockOwner: null });
  });
});
