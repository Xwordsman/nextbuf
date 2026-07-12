import { createOutboxEvent } from "@/infrastructure/outbox/create-event";
import { getPrismaClient } from "@/infrastructure/database/client";
import { encryptMailPayload } from "@/infrastructure/mail/encryption";

export const IDENTITY_EMAIL_TOPIC = "nextbuf.identity.email.send";

type QueueIdentityEmailInput = {
  kind: "email-verification" | "password-reset";
  recipient: string;
  subject: string;
  text: string;
  html: string;
};

export async function queueIdentityEmail(input: QueueIdentityEmailInput): Promise<void> {
  const encrypted = encryptMailPayload({ text: input.text, html: input.html });

  await getPrismaClient().$transaction(async (transaction) => {
    const delivery = await transaction.emailDelivery.create({
      data: {
        kind: input.kind,
        recipient: input.recipient,
        subject: input.subject,
        ...encrypted,
      },
    });

    await createOutboxEvent(transaction, {
      topic: IDENTITY_EMAIL_TOPIC,
      idempotencyKey: `identity-email:${delivery.id}`,
      payload: { deliveryId: delivery.id },
    });
  });
}
