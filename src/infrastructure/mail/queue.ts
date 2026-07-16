import type { Prisma } from "@/generated/prisma/client";
import { createOutboxEvent } from "@/infrastructure/outbox/create-event";
import { getPrismaClient } from "@/infrastructure/database/client";
import { encryptMailPayload } from "@/infrastructure/mail/encryption";

export const IDENTITY_EMAIL_TOPIC = "nextbuf.identity.email.send";
export const MAIL_DELIVERY_TOPIC = "nextbuf.mail.delivery.send";

export type QueueEmailInput = {
  kind: string;
  recipient: string;
  subject: string;
  text: string;
  html: string;
};

export async function createQueuedEmailDelivery(
  transaction: Prisma.TransactionClient,
  input: QueueEmailInput,
  options: { topic?: string; idempotencyPrefix?: string } = {},
) {
  const encrypted = encryptMailPayload({ text: input.text, html: input.html });
  const delivery = await transaction.emailDelivery.create({
    data: {
      kind: input.kind,
      recipient: input.recipient,
      subject: input.subject,
      ...encrypted,
    },
  });

  await createOutboxEvent(transaction, {
    topic: options.topic ?? MAIL_DELIVERY_TOPIC,
    idempotencyKey: `${options.idempotencyPrefix ?? "mail-delivery"}:${delivery.id}`,
    payload: { deliveryId: delivery.id },
  });
  return delivery;
}

type QueueIdentityEmailInput = {
  kind: "email-verification" | "password-reset";
  recipient: string;
  subject: string;
  text: string;
  html: string;
};

export async function queueIdentityEmail(input: QueueIdentityEmailInput): Promise<void> {
  await getPrismaClient().$transaction(async (transaction) => {
    await createQueuedEmailDelivery(transaction, input, {
      topic: IDENTITY_EMAIL_TOPIC,
      idempotencyPrefix: "identity-email",
    });
  });
}

export async function queueTestEmail(recipient: string): Promise<void> {
  const now = new Date();
  await getPrismaClient().$transaction(async (transaction) => {
    await createQueuedEmailDelivery(transaction, {
      kind: "system-test",
      recipient,
      subject: "NextBuf 测试邮件",
      text: `NextBuf SMTP 投递测试已于 ${now.toISOString()} 入队。`,
      html: `<p>NextBuf SMTP 投递测试已于 <strong>${now.toISOString()}</strong> 入队。</p>`,
    });
  });
}
