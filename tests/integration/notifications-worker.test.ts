import type { Job } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "@/cli/commands/setup";
import { disconnectRedisClient, getRedisClient } from "@/infrastructure/cache/redis";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { encryptMailPayload } from "@/infrastructure/mail/encryption";
import {
  IDENTITY_EMAIL_TOPIC,
  MAIL_DELIVERY_TOPIC,
  queueIdentityEmail,
} from "@/infrastructure/mail/queue";
import { mailOutcomeUnknownError, toSafeMailError } from "@/infrastructure/mail/errors";
import {
  claimEmailDelivery,
  EmailDeliveryAttemptLostError,
  markEmailDeliveryOutcomeUnknown,
  markEmailDeliveryProviderFailure,
  markEmailDeliverySent,
  setMailProviderForTests,
} from "@/infrastructure/mail/smtp";
import {
  dispatchOutboxBatch,
  recoverPublishedOutboxBatch,
} from "@/infrastructure/outbox/dispatcher";
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
import { getServiceEnvironment } from "@/shared/config/runtime-env";
import { createOutboxWorker } from "@/worker/processors/outbox";
import { WORKER_MAINTENANCE_TASK } from "@/worker/contracts";
import {
  processReplayRequests,
  recordWorkerFailure,
  requestWorkerReplay,
} from "@/worker/failures.server";
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

function finalMailJobWithPayload(
  eventId: string,
  topic: string,
  payload: OutboxJobData["payload"],
): Job<OutboxJobData> {
  return {
    id: eventId,
    name: OUTBOX_JOB_NAME,
    data: { eventId, topic, version: 1, payload },
    opts: { attempts: 1 },
    attemptsMade: 0,
  } as unknown as Job<OutboxJobData>;
}

function finalMailJob(eventId: string, topic: string, deliveryId: string): Job<OutboxJobData> {
  return finalMailJobWithPayload(eventId, topic, { deliveryId });
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
    setMailProviderForTests(undefined);
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
      userId: member.id,
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

  it("persists only sanitized mail failures and cascades them with the delivery", async () => {
    const prisma = getPrismaClient();
    const member = await actor("Mail Failure Privacy");
    const notification = await prisma.notification.create({
      data: {
        recipientId: member.id,
        type: "management",
        dedupeKey: `mail-failure-privacy:${Date.now()}`,
        snapshot: { actorName: member.name, actorUsername: member.username },
      },
    });
    const delivery = await prisma.emailDelivery.create({
      data: {
        kind: "notification-management",
        recipient: member.email,
        subject: "Failure privacy",
        ...encryptMailPayload({ text: "Failure privacy", html: "<p>Failure privacy</p>" }),
      },
    });
    await prisma.notificationDelivery.create({
      data: {
        notificationId: notification.id,
        channel: "email",
        status: "queued",
        emailDeliveryId: delivery.id,
      },
    });
    const event = await prisma.outboxEvent.create({
      data: {
        topic: MAIL_DELIVERY_TOPIC,
        idempotencyKey: `mail-failure-privacy:${delivery.id}`,
        payload: { deliveryId: delivery.id },
        publishedAt: new Date(),
      },
    });
    const unsafe = Object.assign(
      new Error(`535 rejected ${member.email} for @${member.username}`),
      {
        code: "EAUTH",
        responseCode: 535,
        response: `raw relay response for ${member.email}`,
        cause: new Error(`credential rejected for @${member.username}`),
      },
    );
    const claim = await claimEmailDelivery(delivery.id);
    if (claim.state !== "claimed") throw new Error("Expected test delivery to be claimed");

    await recordWorkerFailure(finalMailJob(event.id, event.topic, delivery.id), unsafe, 1, {
      mailAttempt: claim.delivery,
    });

    const failure = await prisma.workerJobFailure.findUniqueOrThrow({
      where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
    });
    expect(failure).toMatchObject({
      emailDeliveryId: delivery.id,
      attempts: 1,
      lastError: "Mail delivery failed (EAUTH; SMTP 535)",
    });
    expect(JSON.stringify(failure)).not.toContain(member.email);
    expect(JSON.stringify(failure)).not.toContain(member.username);
    await expect(
      prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
    ).resolves.toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "Mail delivery failed (EAUTH; SMTP 535)",
    });
    await expect(
      prisma.notificationDelivery.findUniqueOrThrow({
        where: { emailDeliveryId: delivery.id },
      }),
    ).resolves.toMatchObject({ status: "failed" });

    await prisma.emailDelivery.delete({ where: { id: delivery.id } });
    await expect(
      prisma.workerJobFailure.findUnique({ where: { id: failure.id } }),
    ).resolves.toBeNull();
    await recordWorkerFailure(finalMailJob(event.id, event.topic, delivery.id), unsafe, 1, {
      mailAttempt: claim.delivery,
    });
    await expect(
      prisma.workerJobFailure.findUnique({
        where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
      }),
    ).resolves.toBeNull();
    await prisma.outboxEvent.delete({ where: { id: event.id } });
  });

  it("persists malformed mail payload failures and allows their replay", async () => {
    const prisma = getPrismaClient();
    const operator = await actor("Malformed Mail Replay Operator");
    const cases: Array<{ name: string; payload: OutboxJobData["payload"] }> = [
      { name: "missing", payload: {} },
      { name: "non-string", payload: { deliveryId: 42 } },
      { name: "invalid-uuid", payload: { deliveryId: "not-a-uuid" } },
    ];
    const suffix = Date.now();
    const events = await Promise.all(
      cases.map(({ name, payload }) =>
        prisma.outboxEvent.create({
          data: {
            topic: MAIL_DELIVERY_TOPIC,
            idempotencyKey: `notifications-test:malformed-mail-payload:${suffix}:${name}`,
            payload,
            publishedAt: new Date(),
          },
        }),
      ),
    );

    try {
      for (const [index, event] of events.entries()) {
        const testCase = cases[index];
        if (!testCase) throw new Error("Missing malformed mail payload test case");
        await recordWorkerFailure(
          finalMailJobWithPayload(event.id, event.topic, testCase.payload),
          new Error(`Malformed mail payload: ${testCase.name}`),
          1,
        );
      }

      const failures = await prisma.workerJobFailure.findMany({
        where: { queueName: SYSTEM_QUEUE_NAME, jobId: { in: events.map(({ id }) => id) } },
        orderBy: { jobId: "asc" },
      });
      expect(failures).toHaveLength(cases.length);
      for (const failure of failures) {
        expect(failure).toMatchObject({
          emailDeliveryId: null,
          attempts: 1,
          lastError: "Mail delivery failed",
          resolvedAt: null,
        });
      }

      await recoverPublishedOutboxBatch(
        "malformed-mail-payload-recovery",
        new Date(Date.now() + getServiceEnvironment().OUTBOX_RECOVERY_AFTER_MS + 1_000),
      );
      for (const event of events) {
        await expect(getSystemQueue().getJob(event.id)).resolves.toBeUndefined();
      }

      const replayFailure = failures[0];
      if (!replayFailure) throw new Error("Expected malformed mail failure for replay");
      await expect(requestWorkerReplay(replayFailure.id, operator.id)).resolves.toBe(true);
      await expect(processReplayRequests()).resolves.toBeGreaterThanOrEqual(1);
      await expect(
        prisma.workerJobFailure.findUniqueOrThrow({ where: { id: replayFailure.id } }),
      ).resolves.toMatchObject({ replayCount: 1, replayedAt: expect.any(Date), resolvedAt: null });
      await expect(
        prisma.outboxEvent.findUniqueOrThrow({ where: { id: replayFailure.jobId } }),
      ).resolves.toMatchObject({
        publishedAt: null,
        processedAt: null,
        lockedAt: null,
        lockOwner: null,
      });
    } finally {
      for (const event of events) {
        await (await getSystemQueue().getJob(event.id))?.remove();
      }
      await prisma.workerJobFailure.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, jobId: { in: events.map(({ id }) => id) } },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: { in: events.map(({ id }) => id) } } });
      await prisma.user.deleteMany({ where: { id: operator.id } });
    }
  });

  it("does not recreate a mail failure when delivery deletion wins the row-lock race", async () => {
    const prisma = getPrismaClient();
    const member = await actor("Late Mail Failure");
    await queueIdentityEmail({
      userId: member.id,
      kind: "password-reset",
      recipient: member.email,
      subject: "Late failure",
      text: "Late failure",
      html: "<p>Late failure</p>",
    });
    const delivery = await prisma.emailDelivery.findFirstOrThrow({
      where: { recipient: member.email, kind: "password-reset" },
      orderBy: { createdAt: "desc" },
    });
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `identity-email:${delivery.id}` },
    });
    const claim = await claimEmailDelivery(delivery.id);
    if (claim.state !== "claimed") throw new Error("Expected test delivery to be claimed");
    let deletionStarted!: () => void;
    let releaseDeletion!: () => void;
    const started = new Promise<void>((resolve) => {
      deletionStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const deletion = prisma.$transaction(async (transaction) => {
      await transaction.emailDelivery.delete({ where: { id: delivery.id } });
      deletionStarted();
      await release;
    });
    await started;
    let recorded = false;
    const recording = recordWorkerFailure(
      finalMailJob(event.id, IDENTITY_EMAIL_TOPIC, delivery.id),
      Object.assign(new Error(`timeout for ${member.email}`), { code: "ETIMEDOUT" }),
      1,
      { mailAttempt: claim.delivery },
    ).then(() => {
      recorded = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(recorded).toBe(false);
    releaseDeletion();
    await Promise.all([deletion, recording]);
    await expect(
      prisma.workerJobFailure.findUnique({
        where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
      }),
    ).resolves.toBeNull();
    await prisma.outboxEvent.delete({ where: { id: event.id } });
  });

  it("requires explicit replay after an interrupted SMTP attempt instead of resending", async () => {
    const prisma = getPrismaClient();
    const member = await actor("Interrupted Mail");
    const operator = await actor("Interrupted Mail Operator");
    await queueIdentityEmail({
      userId: member.id,
      kind: "password-reset",
      recipient: member.email,
      subject: "Interrupted mail",
      text: "Interrupted mail",
      html: "<p>Interrupted mail</p>",
    });
    const delivery = await prisma.emailDelivery.findFirstOrThrow({
      where: { recipient: member.email, kind: "password-reset" },
      orderBy: { createdAt: "desc" },
    });
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `identity-email:${delivery.id}` },
    });
    await expect(claimEmailDelivery(delivery.id)).resolves.toMatchObject({ state: "claimed" });

    let sends = 0;
    setMailProviderForTests({
      async send() {
        sends += 1;
      },
    });
    const worker = createOutboxWorker();

    try {
      await worker.worker.waitUntilReady();
      await dispatchOutboxBatch("interrupted-mail-publisher");
      await waitFor(async () =>
        Boolean(
          await prisma.workerJobFailure.findUnique({
            where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
          }),
        ),
      );

      expect(sends).toBe(0);
      await expect(
        prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).resolves.toMatchObject({
        status: "outcome_unknown",
        attempts: 1,
        lastError: "Mail delivery failed (EOUTCOMEUNKNOWN)",
      });
      const failure = await prisma.workerJobFailure.findUniqueOrThrow({
        where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
      });
      expect(failure).toMatchObject({
        attempts: 1,
        lastError: "Mail delivery failed (EOUTCOMEUNKNOWN)",
        resolvedAt: null,
      });

      await expect(requestWorkerReplay(failure.id, operator.id)).resolves.toBe(false);
      await expect(
        requestWorkerReplay(failure.id, operator.id, { acknowledgeDuplicateRisk: true }),
      ).resolves.toBe(true);
      await expect(
        requestWorkerReplay(failure.id, operator.id, { acknowledgeDuplicateRisk: true }),
      ).resolves.toBe(false);
      await expect(processReplayRequests()).resolves.toBeGreaterThanOrEqual(1);
      await expect(
        requestWorkerReplay(failure.id, operator.id, { acknowledgeDuplicateRisk: true }),
      ).resolves.toBe(false);
      await expect(
        prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).resolves.toMatchObject({ status: "pending", attempts: 1, lastError: null });

      await dispatchOutboxBatch("interrupted-mail-replay-publisher");
      await waitFor(async () => {
        const current = await prisma.emailDelivery.findUnique({ where: { id: delivery.id } });
        return current?.status === "sent";
      });
      expect(sends).toBe(1);
      await expect(
        prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).resolves.toMatchObject({ status: "sent", attempts: 2, sentAt: expect.any(Date) });
      await expect(
        prisma.workerJobFailure.findUniqueOrThrow({ where: { id: failure.id } }),
      ).resolves.toMatchObject({ replayCount: 1, resolvedAt: expect.any(Date) });
    } finally {
      setMailProviderForTests(undefined);
      await worker.worker.close();
      if (worker.connection.status !== "end") await worker.connection.quit();
      await (await getSystemQueue().getJob(event.id))?.remove();
      await prisma.processedJob.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
      await prisma.emailDelivery.deleteMany({ where: { id: delivery.id } });
      await prisma.user.deleteMany({ where: { id: { in: [member.id, operator.id] } } });
    }
  });

  it("retries an explicitly unaccepted connection failure and sends exactly once", async () => {
    const prisma = getPrismaClient();
    const member = await actor("Retryable Connection Mail");
    await queueIdentityEmail({
      userId: member.id,
      kind: "password-reset",
      recipient: member.email,
      subject: "Retryable connection mail",
      text: "Retryable connection mail",
      html: "<p>Retryable connection mail</p>",
    });
    const delivery = await prisma.emailDelivery.findFirstOrThrow({
      where: { recipient: member.email, kind: "password-reset" },
      orderBy: { createdAt: "desc" },
    });
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `identity-email:${delivery.id}` },
    });
    let sends = 0;
    setMailProviderForTests({
      async send() {
        sends += 1;
        if (sends === 1) {
          throw Object.assign(new Error("connection refused"), {
            code: "ECONNREFUSED",
            command: "CONN",
          });
        }
      },
    });
    const worker = createOutboxWorker();

    try {
      await worker.worker.waitUntilReady();
      await expect(dispatchOutboxBatch("retryable-mail-publisher")).resolves.toMatchObject({
        dispatched: 1,
        failed: 0,
      });
      await waitFor(async () => {
        const current = await prisma.emailDelivery.findUnique({ where: { id: delivery.id } });
        return current?.status === "sent";
      });

      expect(sends).toBe(2);
      await expect(
        prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).resolves.toMatchObject({
        status: "sent",
        attempts: 2,
        attemptGeneration: 2,
        sentAt: expect.any(Date),
      });
      await expect(
        prisma.workerJobFailure.count({ where: { jobId: event.id, resolvedAt: null } }),
      ).resolves.toBe(0);
    } finally {
      setMailProviderForTests(undefined);
      await worker.worker.close();
      if (worker.connection.status !== "end") await worker.connection.quit();
      await (await getSystemQueue().getJob(event.id))?.remove();
      await prisma.processedJob.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
      await prisma.emailDelivery.deleteMany({ where: { id: delivery.id } });
      await prisma.user.deleteMany({ where: { id: member.id } });
    }
  });

  it("preserves a lost PostgreSQL processing lease after SMTP acceptance", async () => {
    const prisma = getPrismaClient();
    const member = await actor("Accepted Mail Lease Loss");
    await queueIdentityEmail({
      userId: member.id,
      kind: "password-reset",
      recipient: member.email,
      subject: "Accepted mail lease loss",
      text: "Accepted mail lease loss",
      html: "<p>Accepted mail lease loss</p>",
    });
    const delivery = await prisma.emailDelivery.findFirstOrThrow({
      where: { recipient: member.email, kind: "password-reset" },
      orderBy: { createdAt: "desc" },
    });
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `identity-email:${delivery.id}` },
    });
    let signalAccepted!: () => void;
    let releaseAccepted!: () => void;
    const accepted = new Promise<void>((resolve) => {
      signalAccepted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseAccepted = resolve;
    });
    let sends = 0;
    setMailProviderForTests({
      async send() {
        sends += 1;
        signalAccepted();
        await release;
      },
    });
    const worker = createOutboxWorker();
    const failures: Error[] = [];
    worker.worker.on("failed", (_job, error) => failures.push(error));

    try {
      await worker.worker.waitUntilReady();
      await expect(
        dispatchOutboxBatch("accepted-mail-lease-loss-publisher"),
      ).resolves.toMatchObject({ dispatched: 1, failed: 0 });
      await accepted;
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { lockOwner: "outbox-processing:integration-takeover", lockedAt: new Date() },
      });
      releaseAccepted();
      await waitFor(async () =>
        failures.some((error) => error.name === "OutboxProcessingLeaseLostError"),
      );

      expect(sends).toBe(1);
      await expect(
        prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).resolves.toMatchObject({
        status: "outcome_unknown",
        attempts: 1,
        lastError: "Mail delivery failed (EOUTCOMEUNKNOWN)",
      });
      await expect(prisma.workerJobFailure.count({ where: { jobId: event.id } })).resolves.toBe(0);
    } finally {
      releaseAccepted();
      setMailProviderForTests(undefined);
      await worker.worker.close();
      if (worker.connection.status !== "end") await worker.connection.quit();
      await (await getSystemQueue().getJob(event.id))?.remove();
      await prisma.processedJob.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
      await prisma.emailDelivery.deleteMany({ where: { id: delivery.id } });
      await prisma.user.deleteMany({ where: { id: member.id } });
    }
  });

  it("uses PostgreSQL leases and attempt fencing after Redis loss", async () => {
    const prisma = getPrismaClient();
    const member = await actor("Mail Attempt Fence");
    const operator = await actor("Mail Attempt Fence Operator");
    await queueIdentityEmail({
      userId: member.id,
      kind: "password-reset",
      recipient: member.email,
      subject: "Attempt fence",
      text: "Attempt fence",
      html: "<p>Attempt fence</p>",
    });
    const delivery = await prisma.emailDelivery.findFirstOrThrow({
      where: { recipient: member.email, kind: "password-reset" },
      orderBy: { createdAt: "desc" },
    });
    const event = await prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: `identity-email:${delivery.id}` },
    });
    const claim = await claimEmailDelivery(delivery.id);
    if (claim.state !== "claimed") throw new Error("Expected test delivery to be claimed");
    await markEmailDeliveryOutcomeUnknown(claim.delivery);
    await recordWorkerFailure(
      finalMailJob(event.id, event.topic, delivery.id),
      mailOutcomeUnknownError(),
      1,
      { terminal: true, mailAttempt: claim.delivery },
    );
    const failure = await prisma.workerJobFailure.findUniqueOrThrow({
      where: { queueName_jobId: { queueName: SYSTEM_QUEUE_NAME, jobId: event.id } },
    });
    await prisma.emailDelivery.update({
      where: { id: delivery.id },
      data: { status: "sending", lastError: null },
    });

    try {
      await getRedisClient().flushdb();
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { lockOwner: "outbox-processing:integration-old-worker", lockedAt: new Date() },
      });
      await expect(
        requestWorkerReplay(failure.id, operator.id, { acknowledgeDuplicateRisk: true }),
      ).resolves.toBe(false);

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          lockedAt: new Date(Date.now() - getServiceEnvironment().OUTBOX_LOCK_TIMEOUT_MS - 1),
        },
      });
      await expect(requestWorkerReplay(failure.id, operator.id)).resolves.toBe(false);
      await expect(
        requestWorkerReplay(failure.id, operator.id, { acknowledgeDuplicateRisk: true }),
      ).resolves.toBe(true);
      await expect(processReplayRequests()).resolves.toBeGreaterThanOrEqual(1);

      const replayed = await prisma.emailDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      });
      expect(replayed).toMatchObject({ status: "pending", lastError: null });
      expect(replayed.attemptToken).not.toBe(claim.delivery.attemptToken);
      expect(replayed.attemptGeneration).toBeGreaterThan(claim.delivery.attemptGeneration);

      const permanent = toSafeMailError(
        Object.assign(new Error("late authentication failure"), {
          code: "EAUTH",
          responseCode: 535,
        }),
      );
      await expect(
        markEmailDeliveryProviderFailure(claim.delivery, permanent),
      ).rejects.toBeInstanceOf(EmailDeliveryAttemptLostError);
      await expect(
        recordWorkerFailure(finalMailJob(event.id, event.topic, delivery.id), permanent, 1, {
          terminal: true,
          mailAttempt: claim.delivery,
        }),
      ).rejects.toBeInstanceOf(EmailDeliveryAttemptLostError);
      await expect(
        prisma.$transaction((transaction) => markEmailDeliverySent(transaction, claim.delivery)),
      ).rejects.toBeInstanceOf(EmailDeliveryAttemptLostError);
      await expect(
        prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).resolves.toMatchObject({
        status: "pending",
        attemptToken: replayed.attemptToken,
        attemptGeneration: replayed.attemptGeneration,
      });
      await expect(
        prisma.workerJobFailure.findUniqueOrThrow({ where: { id: failure.id } }),
      ).resolves.toMatchObject({
        replayCount: 1,
        replayedAt: expect.any(Date),
        replayDuplicateRiskAcknowledgedAt: expect.any(Date),
      });
    } finally {
      await (await getSystemQueue().getJob(event.id))?.remove();
      await prisma.processedJob.deleteMany({
        where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
      });
      await prisma.outboxEvent.deleteMany({ where: { id: event.id } });
      await prisma.emailDelivery.deleteMany({ where: { id: delivery.id } });
      await prisma.user.deleteMany({ where: { id: { in: [member.id, operator.id] } } });
    }
  });

  it("recovers a replayed event after Redis loss while new final failures remain blocked", async () => {
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
    await prisma.$transaction([
      prisma.processedJob.create({
        data: {
          queueName: SYSTEM_QUEUE_NAME,
          jobName: OUTBOX_JOB_NAME,
          idempotencyKey: `outbox-${event.id}`,
        },
      }),
      prisma.outboxEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() },
      }),
    ]);
    await expect(requestWorkerReplay(failure.id, operator.id)).resolves.toBe(true);
    await expect(processReplayRequests()).resolves.toBeGreaterThanOrEqual(1);
    await expect(getSystemQueue().getJob(event.id)).resolves.toBeUndefined();
    await expect(
      prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } }),
    ).resolves.toMatchObject({
      publishedAt: null,
      processedAt: null,
      lockedAt: null,
    });
    await expect(
      prisma.workerJobFailure.findUniqueOrThrow({ where: { id: failure.id } }),
    ).resolves.toMatchObject({
      replayCount: 1,
      replayedAt: expect.any(Date),
    });
    await expect(
      prisma.processedJob.count({
        where: { queueName: SYSTEM_QUEUE_NAME, idempotencyKey: `outbox-${event.id}` },
      }),
    ).resolves.toBe(0);

    await expect(dispatchOutboxBatch("replayed-event-publisher")).resolves.toMatchObject({
      dispatched: 1,
      failed: 0,
    });
    await getRedisClient().flushdb();
    const recoveryNow = new Date(
      Date.now() + getServiceEnvironment().OUTBOX_RECOVERY_AFTER_MS + 1_000,
    );
    await expect(
      recoverPublishedOutboxBatch("replayed-event-recovery", recoveryNow),
    ).resolves.toEqual({ alreadyQueued: 0, checked: 1, failed: 0, requeued: 1 });
    await expect(getSystemQueue().getJob(event.id)).resolves.toBeDefined();

    await recordWorkerFailure(
      finalMailJob(event.id, event.topic, "40000000-0000-4000-8000-000000000001"),
      new Error("New final failure after replay"),
      1,
    );
    await (await getSystemQueue().getJob(event.id))?.remove();
    const newFailure = await prisma.workerJobFailure.findUniqueOrThrow({
      where: { id: failure.id },
    });
    expect(newFailure).toMatchObject({ replayedAt: null, resolvedAt: null });
    await expect(
      recoverPublishedOutboxBatch(
        "new-final-failure-recovery",
        new Date(recoveryNow.getTime() + getServiceEnvironment().OUTBOX_RECOVERY_AFTER_MS + 1_000),
      ),
    ).resolves.toEqual({ alreadyQueued: 0, checked: 0, failed: 0, requeued: 0 });
    await expect(getSystemQueue().getJob(event.id)).resolves.toBeUndefined();

    await prisma.workerJobFailure.delete({ where: { id: failure.id } });
    await prisma.outboxEvent.delete({ where: { id: event.id } });
  });

  it("allows only one Worker to claim the same scheduled run", async () => {
    const prisma = getPrismaClient();
    await prisma.workerScheduledTask.updateMany({
      data: {
        nextRunAt: new Date(Date.now() + 86_400_000),
        lockedAt: null,
        lockOwner: null,
      },
    });
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

  it("renews scheduled task leases and fences a late owner after takeover", async () => {
    const prisma = getPrismaClient();
    await prisma.workerScheduledTask.updateMany({
      data: {
        nextRunAt: new Date(Date.now() + 86_400_000),
        lockedAt: null,
        lockOwner: null,
      },
    });
    const before = await prisma.workerScheduledTask.update({
      where: { name: WORKER_MAINTENANCE_TASK },
      data: { nextRunAt: new Date(0), lockedAt: null, lockOwner: null, lastError: null },
    });
    let taskStarted!: () => void;
    let releaseTask!: () => void;
    const started = new Promise<void>((resolve) => {
      taskStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });
    const firstRun = runScheduledTasks(
      "scheduler-lease-a",
      new Date(),
      async (_name, _workerId, _now, assertLease) => {
        taskStarted();
        await release;
        assertLease();
        return { executor: "scheduler-lease-a" };
      },
    );
    await started;
    await new Promise((resolve) =>
      setTimeout(resolve, getServiceEnvironment().WORKER_TASK_LOCK_TIMEOUT_MS + 500),
    );

    await expect(
      runScheduledTasks("scheduler-lease-b-blocked", new Date(), async () => ({
        executor: "blocked",
      })),
    ).resolves.toBe(0);

    await prisma.workerScheduledTask.update({
      where: { name: WORKER_MAINTENANCE_TASK },
      data: { lockOwner: "scheduler-lease-forced-stale", lockedAt: new Date(0) },
    });
    await expect(
      runScheduledTasks("scheduler-lease-b", new Date(), async () => ({
        executor: "scheduler-lease-b",
      })),
    ).resolves.toBe(1);
    releaseTask();
    await expect(firstRun).rejects.toThrow("Scheduled task lease was lost");

    await expect(
      prisma.workerScheduledTask.findUniqueOrThrow({ where: { name: WORKER_MAINTENANCE_TASK } }),
    ).resolves.toMatchObject({
      runCount: before.runCount + 1,
      lockedAt: null,
      lockOwner: null,
      lastError: null,
    });
    await expect(
      prisma.systemState.findUniqueOrThrow({
        where: { key: `worker.last_task.${WORKER_MAINTENANCE_TASK}` },
      }),
    ).resolves.toMatchObject({
      value: { workerId: "scheduler-lease-b", executor: "scheduler-lease-b" },
    });
  });
});
