import nodemailer, { type Transporter } from "nodemailer";
import type { Prisma } from "@/generated/prisma/client";
import { decryptMailPayload } from "@/infrastructure/mail/encryption";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

let transporter: Transporter | undefined;

export type MailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
};

export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

class SmtpMailProvider implements MailProvider {
  async send(message: MailMessage): Promise<void> {
    await getTransporter().sendMail(message);
  }
}

let mailProvider: MailProvider | undefined;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const environment = getAuthEnvironment();

  transporter = nodemailer.createTransport({
    host: environment.SMTP_HOST,
    port: environment.SMTP_PORT,
    secure: environment.SMTP_SECURE,
    auth:
      environment.SMTP_USER && environment.SMTP_PASSWORD
        ? { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD }
        : undefined,
  });
  return transporter;
}

export function getMailProvider(): MailProvider {
  mailProvider ??= new SmtpMailProvider();
  return mailProvider;
}

export async function sendEmailDelivery(transaction: Prisma.TransactionClient, deliveryId: string) {
  const delivery = await transaction.emailDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery || delivery.status === "sent") return;

  const payload = decryptMailPayload(delivery);
  if (typeof payload.text !== "string" || typeof payload.html !== "string") {
    throw new Error(`Email delivery ${delivery.id} payload is invalid`);
  }
  await transaction.emailDelivery.update({
    where: { id: delivery.id },
    data: { status: "sending", attempts: { increment: 1 }, lastError: null },
  });

  await getMailProvider().send({
    from: getAuthEnvironment().SMTP_FROM,
    to: delivery.recipient,
    subject: delivery.subject,
    text: payload.text,
    html: payload.html,
    messageId: `<${delivery.id}@nextbuf.local>`,
  });

  await transaction.emailDelivery.update({
    where: { id: delivery.id },
    data: { status: "sent", sentAt: new Date(), lastError: null },
  });
  await transaction.notificationDelivery.updateMany({
    where: { emailDeliveryId: delivery.id },
    data: { status: "delivered" },
  });
}
