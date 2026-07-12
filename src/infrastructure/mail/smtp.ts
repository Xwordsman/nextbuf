import nodemailer, { type Transporter } from "nodemailer";
import type { Prisma } from "@/generated/prisma/client";
import { decryptMailPayload } from "@/infrastructure/mail/encryption";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

let transporter: Transporter | undefined;

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

export async function sendEmailDelivery(transaction: Prisma.TransactionClient, deliveryId: string) {
  const delivery = await transaction.emailDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery || delivery.status === "sent") return;

  const payload = decryptMailPayload(delivery);
  await transaction.emailDelivery.update({
    where: { id: delivery.id },
    data: { status: "sending", attempts: { increment: 1 }, lastError: null },
  });

  await getTransporter().sendMail({
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
}
