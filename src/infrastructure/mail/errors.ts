const allowedMailErrorCodes = new Set([
  "EAUTH",
  "ECONNECTION",
  "ECONNREFUSED",
  "ECONNRESET",
  "EDNS",
  "EENVELOPE",
  "EHOSTUNREACH",
  "EMESSAGE",
  "ENETUNREACH",
  "ENOTFOUND",
  "EOUTCOMEUNKNOWN",
  "ESOCKET",
  "ETIMEOUT",
  "ETIMEDOUT",
]);

const retryableConnectionCodes = new Set([
  "ECONNREFUSED",
  "EDNS",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
]);
const permanentMailErrorCodes = new Set(["EAUTH", "EENVELOPE", "EMESSAGE"]);
const ambiguousSocketCodes = new Set([
  "ECONNECTION",
  "ECONNRESET",
  "ESOCKET",
  "ETIMEOUT",
  "ETIMEDOUT",
]);

export type MailFailureDisposition = "retryable" | "permanent" | "outcome_unknown";

function readOwnValue(
  error: unknown,
  key: "code" | "responseCode" | "message" | "syscall",
): unknown {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) {
    return undefined;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function normalizedOwnString(error: unknown, key: "code" | "syscall"): string | undefined {
  const value = readOwnValue(error, key);
  return typeof value === "string" ? value.toUpperCase() : undefined;
}

function numericResponseCode(error: unknown): number | undefined {
  const value = readOwnValue(error, "responseCode");
  return typeof value === "number" && Number.isInteger(value) && value >= 200 && value <= 599
    ? value
    : undefined;
}

function classifyMailFailure(error: unknown): MailFailureDisposition {
  const responseCode = numericResponseCode(error);
  if (responseCode && responseCode >= 400 && responseCode <= 499) return "retryable";
  if (responseCode && responseCode >= 500) return "permanent";

  const code = normalizedOwnString(error, "code");
  if (code && retryableConnectionCodes.has(code)) return "retryable";
  if (code && permanentMailErrorCodes.has(code)) return "permanent";

  if (code && ambiguousSocketCodes.has(code)) {
    // Nodemailer reports both initial connection failures and post-DATA socket
    // failures with command=CONN. Only native connect(2) failures and its exact
    // pre-message timeouts prove that the SMTP server did not accept the mail.
    if (normalizedOwnString(error, "syscall") === "CONNECT") return "retryable";
    const message = readOwnValue(error, "message");
    if (message === "Connection timeout" || message === "Greeting never received") {
      return "retryable";
    }
  }

  return "outcome_unknown";
}

function safeMailErrorMessage(error: unknown): string {
  const rawCode = normalizedOwnString(error, "code");
  const code = rawCode && allowedMailErrorCodes.has(rawCode) ? rawCode : undefined;
  const responseCode = numericResponseCode(error);
  const details = [code, responseCode ? `SMTP ${responseCode}` : undefined].filter(Boolean);

  return details.length > 0
    ? `Mail delivery failed (${details.join("; ")})`
    : "Mail delivery failed";
}

export class SafeMailError extends Error {
  readonly disposition: MailFailureDisposition;

  constructor(error: unknown, disposition = classifyMailFailure(error)) {
    super(safeMailErrorMessage(error));
    this.name = "MailDeliveryError";
    this.disposition = disposition;
    this.stack = undefined;
  }
}

export function toSafeMailError(error: unknown): SafeMailError {
  try {
    if (error instanceof SafeMailError) return error;
  } catch {
    // Treat hostile diagnostic objects as unknown provider failures.
  }
  return new SafeMailError(error);
}

export function mailOutcomeUnknownError(): SafeMailError {
  return new SafeMailError(
    Object.assign(new Error("Mail delivery outcome is unknown"), { code: "EOUTCOMEUNKNOWN" }),
    "outcome_unknown",
  );
}

export function mailPermanentFailureError(): SafeMailError {
  return new SafeMailError(undefined, "permanent");
}
