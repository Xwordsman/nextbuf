import { describe, expect, it } from "vitest";
import { redactLogContext } from "@/infrastructure/observability/logger";

describe("structured log redaction", () => {
  it("recursively removes identity and credential fields", () => {
    expect(
      redactLogContext({
        email: "member@example.com",
        nested: {
          accessToken: "token-value",
          safe: "visible",
          list: [{ databaseUrl: "postgresql://nextbuf:secret@postgres/nextbuf" }],
        },
      }),
    ).toEqual({
      email: "[REDACTED]",
      nested: {
        accessToken: "[REDACTED]",
        safe: "visible",
        list: [{ databaseUrl: "[REDACTED]" }],
      },
    });
  });

  it("sanitizes secrets embedded in otherwise safe error strings", () => {
    const result = redactLogContext({
      error:
        "failed postgresql://nextbuf:database-secret@postgres/nextbuf with Authorization: Bearer abc.def",
    });

    expect(result.error).toBe(
      "failed postgresql://nextbuf:[REDACTED]@postgres/nextbuf with Authorization: [REDACTED]",
    );
  });

  it("redacts email addresses nested inside arbitrary strings and errors", () => {
    const result = redactLogContext({
      diagnostic: {
        list: [
          "SMTP rejected member+private@example.com",
          new Error("recipient OTHER.Member@sub.example.co.uk was rejected"),
        ],
      },
    });

    expect(result).toEqual({
      diagnostic: {
        list: [
          "SMTP rejected [REDACTED]",
          { name: "Error", message: "recipient [REDACTED] was rejected" },
        ],
      },
    });
  });

  it("handles cyclic diagnostic objects without throwing", () => {
    const cyclic: Record<string, unknown> = { safe: true };
    cyclic.self = cyclic;
    expect(redactLogContext({ cyclic })).toEqual({
      cyclic: { safe: true, self: "[CIRCULAR]" },
    });
  });
});
