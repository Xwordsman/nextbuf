import { describe, expect, it } from "vitest";
import { mailOutcomeUnknownError, toSafeMailError } from "@/infrastructure/mail/errors";

describe("mail provider error boundary", () => {
  it("keeps only allowlisted provider and SMTP response codes", () => {
    const unsafe = Object.assign(
      new Error("535 rejected member+private@example.com for @private_member"),
      {
        code: "EAUTH",
        responseCode: 535,
        response: "535 rejected member+private@example.com for @private_member",
        command: "AUTH PLAIN",
        cause: new Error("password and recipient leaked by the provider"),
      },
    );

    const safe = toSafeMailError(unsafe);

    expect(safe).toMatchObject({
      name: "MailDeliveryError",
      message: "Mail delivery failed (EAUTH; SMTP 535)",
      disposition: "permanent",
      stack: undefined,
    });
    expect("cause" in safe).toBe(false);
    expect(JSON.stringify(safe)).not.toMatch(/example\.com|private_member|AUTH PLAIN|password/i);
  });

  it("does not copy unknown codes, string response data, getters or nested causes", () => {
    let getterRead = false;
    const unsafe = {
      code: "PRIVATE_member@example.com",
      responseCode: "535 member@example.com",
      cause: { email: "member@example.com" },
      get response() {
        getterRead = true;
        return "member@example.com";
      },
    };

    const safe = toSafeMailError(unsafe);

    expect(safe.message).toBe("Mail delivery failed");
    expect(safe.stack).toBeUndefined();
    expect(getterRead).toBe(false);
  });

  it("does not weaken an error that already crossed the safe boundary", () => {
    const safe = toSafeMailError(Object.assign(new Error("secret"), { code: "ETIMEDOUT" }));
    expect(toSafeMailError(safe)).toBe(safe);
    expect(safe.message).toBe("Mail delivery failed (ETIMEDOUT)");
  });

  it("uses a fixed operator-visible code for interrupted SMTP outcomes", () => {
    expect(mailOutcomeUnknownError()).toMatchObject({
      name: "MailDeliveryError",
      message: "Mail delivery failed (EOUTCOMEUNKNOWN)",
      disposition: "outcome_unknown",
      stack: undefined,
    });
  });

  it("retries only failures that prove SMTP did not accept the message", () => {
    expect(
      toSafeMailError(Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" })),
    ).toMatchObject({ disposition: "retryable" });
    expect(
      toSafeMailError(Object.assign(new Error("try later"), { responseCode: 421 })),
    ).toMatchObject({ disposition: "retryable" });
    expect(
      toSafeMailError(
        Object.assign(new Error("Connection timeout"), {
          code: "ETIMEDOUT",
          command: "CONN",
        }),
      ),
    ).toMatchObject({ disposition: "retryable" });
    expect(
      toSafeMailError(
        Object.assign(new Error("connect ECONNREFUSED 192.0.2.1:25"), {
          code: "ESOCKET",
          command: "CONN",
          syscall: "connect",
        }),
      ),
    ).toMatchObject({ disposition: "retryable" });
  });

  it("treats permanent rejections and post-connect ambiguity differently", () => {
    expect(
      toSafeMailError(Object.assign(new Error("recipient rejected"), { responseCode: 550 })),
    ).toMatchObject({ disposition: "permanent" });
    expect(
      toSafeMailError(
        Object.assign(new Error("data timeout"), { code: "ETIMEDOUT", command: "DATA" }),
      ),
    ).toMatchObject({ disposition: "outcome_unknown" });
    expect(
      toSafeMailError(Object.assign(new Error("Timeout"), { code: "ETIMEDOUT", command: "CONN" })),
    ).toMatchObject({ disposition: "outcome_unknown" });
    expect(
      toSafeMailError(
        Object.assign(new Error("Connection closed unexpectedly"), {
          code: "ECONNECTION",
          command: "CONN",
        }),
      ),
    ).toMatchObject({ disposition: "outcome_unknown" });
    expect(toSafeMailError(new Error("provider ended unexpectedly"))).toMatchObject({
      disposition: "outcome_unknown",
    });
  });

  it("falls back to the fixed message for hostile diagnostic objects", () => {
    const unsafe = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error("member@example.com");
        },
      },
    );

    expect(toSafeMailError(unsafe).message).toBe("Mail delivery failed");
  });
});
