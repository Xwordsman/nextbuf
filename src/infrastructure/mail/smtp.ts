import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { Prisma, type EmailDelivery } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { decryptMailPayload } from "@/infrastructure/mail/encryption";
import {
  mailOutcomeUnknownError,
  mailPermanentFailureError,
  type MailFailureDisposition,
  SafeMailError,
  toSafeMailError,
} from "@/infrastructure/mail/errors";
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

export type ClaimedEmailDelivery = {
  deliveryId: string;
  attemptToken: string;
  attemptGeneration: number;
  message: MailMessage;
};

export type EmailDeliveryAttempt = Pick<
  ClaimedEmailDelivery,
  "deliveryId" | "attemptToken" | "attemptGeneration"
>;

export type EmailDeliveryClaim =
  | { state: "claimed"; delivery: ClaimedEmailDelivery }
  | { state: "complete" }
  | { state: "blocked"; attempt: EmailDeliveryAttempt; error: SafeMailError };

export class EmailDeliveryAttemptLostError extends Error {
  constructor(deliveryId: string) {
    super(`Email delivery attempt fence was lost for delivery ${deliveryId}`);
    this.name = "EmailDeliveryAttemptLostError";
  }
}

class SmtpMailProvider implements MailProvider {
  async send(message: MailMessage): Promise<void> {
    try {
      await getTransporter().sendMail(message);
    } catch (error) {
      throw toSafeMailError(error);
    }
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
    connectionTimeout: environment.SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: environment.SMTP_GREETING_TIMEOUT_MS,
    socketTimeout: environment.SMTP_SOCKET_TIMEOUT_MS,
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

export function setMailProviderForTests(provider: MailProvider | undefined): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Mail provider overrides are available only in tests");
  }
  mailProvider = provider;
}

export async function verifySmtpConnection(): Promise<void> {
  try {
    await getTransporter().verify();
  } catch (error) {
    throw toSafeMailError(error);
  }
}

function deliveryMessage(delivery: EmailDelivery): MailMessage {
  const payload = decryptMailPayload(delivery);
  if (typeof payload.text !== "string" || typeof payload.html !== "string") {
    throw new Error(`Email delivery ${delivery.id} payload is invalid`);
  }
  return {
    from: getAuthEnvironment().SMTP_FROM,
    to: delivery.recipient,
    subject: delivery.subject,
    text: payload.text,
    html: payload.html,
    messageId: `<${delivery.id}@nextbuf.local>`,
  };
}

async function lockedEmailDelivery(
  transaction: Prisma.TransactionClient,
  deliveryId: string,
): Promise<EmailDelivery | null> {
  const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "email_deliveries"
    WHERE "id" = CAST(${deliveryId} AS uuid)
    FOR UPDATE
  `);
  if (locked.length === 0) return null;
  return transaction.emailDelivery.findUnique({ where: { id: deliveryId } });
}

function deliveryAttempt(delivery: EmailDelivery): EmailDeliveryAttempt {
  return {
    deliveryId: delivery.id,
    attemptToken: delivery.attemptToken,
    attemptGeneration: delivery.attemptGeneration,
  };
}

function sameAttempt(delivery: EmailDelivery, attempt: EmailDeliveryAttempt): boolean {
  return (
    delivery.id === attempt.deliveryId &&
    delivery.attemptToken === attempt.attemptToken &&
    delivery.attemptGeneration === attempt.attemptGeneration
  );
}

type AttemptTransitionResult = "transitioned" | "complete" | "missing";

async function transitionClaimedDelivery(
  transaction: Prisma.TransactionClient,
  attempt: EmailDeliveryAttempt,
  disposition: MailFailureDisposition,
  error: SafeMailError,
  options: { exhausted?: boolean } = {},
): Promise<AttemptTransitionResult> {
  const delivery = await lockedEmailDelivery(transaction, attempt.deliveryId);
  if (!delivery) return "missing";
  if (delivery.status === "sent") return "complete";
  if (!sameAttempt(delivery, attempt)) {
    throw new EmailDeliveryAttemptLostError(attempt.deliveryId);
  }

  const targetStatus =
    disposition === "outcome_unknown"
      ? "outcome_unknown"
      : disposition === "retryable" && !options.exhausted
        ? "pending"
        : "failed";
  const validCurrentStatuses =
    targetStatus === "pending"
      ? ["sending"]
      : targetStatus === "outcome_unknown"
        ? ["sending", "outcome_unknown"]
        : ["sending", "pending", "failed"];
  if (!validCurrentStatuses.includes(delivery.status)) {
    throw new EmailDeliveryAttemptLostError(attempt.deliveryId);
  }

  const updated = await transaction.emailDelivery.updateMany({
    where: {
      id: attempt.deliveryId,
      attemptToken: attempt.attemptToken,
      attemptGeneration: attempt.attemptGeneration,
      status: { in: validCurrentStatuses },
    },
    data: { status: targetStatus, lastError: error.message, sentAt: null },
  });
  if (updated.count !== 1) throw new EmailDeliveryAttemptLostError(attempt.deliveryId);

  if (targetStatus === "failed" || targetStatus === "outcome_unknown") {
    await transaction.notificationDelivery.updateMany({
      where: { emailDeliveryId: attempt.deliveryId, status: { not: "delivered" } },
      data: { status: "failed" },
    });
  }
  return "transitioned";
}

export async function claimEmailDelivery(deliveryId: string): Promise<EmailDeliveryClaim> {
  return getPrismaClient().$transaction(async (transaction) => {
    const delivery = await lockedEmailDelivery(transaction, deliveryId);
    if (!delivery || delivery.status === "sent") return { state: "complete" };

    if (delivery.status === "sending") {
      const error = mailOutcomeUnknownError();
      const attempt = deliveryAttempt(delivery);
      await transitionClaimedDelivery(transaction, attempt, "outcome_unknown", error);
      return { state: "blocked", attempt, error };
    }
    if (delivery.status === "outcome_unknown") {
      return {
        state: "blocked",
        attempt: deliveryAttempt(delivery),
        error: mailOutcomeUnknownError(),
      };
    }
    if (delivery.status === "failed") {
      return {
        state: "blocked",
        attempt: deliveryAttempt(delivery),
        error: mailPermanentFailureError(),
      };
    }
    if (delivery.status !== "pending") {
      throw new Error(`Email delivery ${delivery.id} has unsupported status`);
    }

    const message = deliveryMessage(delivery);
    const attemptToken = randomUUID();
    const attemptGeneration = delivery.attemptGeneration + 1;
    const claimed = await transaction.emailDelivery.updateMany({
      where: {
        id: delivery.id,
        status: "pending",
        attemptToken: delivery.attemptToken,
        attemptGeneration: delivery.attemptGeneration,
      },
      data: {
        status: "sending",
        attempts: { increment: 1 },
        attemptToken,
        attemptGeneration,
        lastError: null,
      },
    });
    if (claimed.count !== 1) throw new EmailDeliveryAttemptLostError(delivery.id);
    return {
      state: "claimed",
      delivery: { deliveryId: delivery.id, attemptToken, attemptGeneration, message },
    };
  });
}

export async function sendClaimedEmailDelivery(delivery: ClaimedEmailDelivery): Promise<void> {
  await getMailProvider().send(delivery.message);
}

export async function markEmailDeliveryProviderFailure(
  attempt: EmailDeliveryAttempt,
  error: SafeMailError,
): Promise<AttemptTransitionResult> {
  return getPrismaClient().$transaction((transaction) =>
    transitionClaimedDelivery(transaction, attempt, error.disposition, error),
  );
}

export async function markEmailDeliveryFinalFailure(
  transaction: Prisma.TransactionClient,
  attempt: EmailDeliveryAttempt,
  error: SafeMailError,
): Promise<AttemptTransitionResult> {
  return transitionClaimedDelivery(transaction, attempt, error.disposition, error, {
    exhausted: true,
  });
}

export async function markEmailDeliveryOutcomeUnknown(
  attempt: EmailDeliveryAttempt,
): Promise<AttemptTransitionResult> {
  const error = mailOutcomeUnknownError();
  return getPrismaClient().$transaction((transaction) =>
    transitionClaimedDelivery(transaction, attempt, error.disposition, error),
  );
}

export async function markEmailDeliverySent(
  transaction: Prisma.TransactionClient,
  attempt: EmailDeliveryAttempt,
): Promise<AttemptTransitionResult> {
  const delivery = await lockedEmailDelivery(transaction, attempt.deliveryId);
  if (!delivery) return "missing";
  if (delivery.status === "sent") return "complete";
  if (!sameAttempt(delivery, attempt) || delivery.status !== "sending") {
    throw new EmailDeliveryAttemptLostError(attempt.deliveryId);
  }

  const updated = await transaction.emailDelivery.updateMany({
    where: {
      id: delivery.id,
      status: "sending",
      attemptToken: attempt.attemptToken,
      attemptGeneration: attempt.attemptGeneration,
    },
    data: { status: "sent", sentAt: new Date(), lastError: null },
  });
  if (updated.count !== 1) throw new EmailDeliveryAttemptLostError(attempt.deliveryId);
  await transaction.notificationDelivery.updateMany({
    where: { emailDeliveryId: delivery.id },
    data: { status: "delivered" },
  });
  return "transitioned";
}
