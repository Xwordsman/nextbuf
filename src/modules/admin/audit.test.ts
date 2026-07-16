import { describe, expect, it } from "vitest";
import {
  auditEventsToCsv,
  redactAuditValue,
  type AdminAuditEvent,
} from "@/modules/admin/audit.server";

describe("admin audit safety", () => {
  it("recursively redacts sensitive fields", () => {
    expect(
      redactAuditValue({
        password: "plain",
        nested: { accessToken: "token", safe: "visible" },
        list: [{ databaseUrl: "postgresql://secret" }],
      }),
    ).toEqual({
      password: "[REDACTED]",
      nested: { accessToken: "[REDACTED]", safe: "visible" },
      list: [{ databaseUrl: "[REDACTED]" }],
    });
  });

  it("escapes CSV cells and neutralizes spreadsheet formulas", () => {
    const event: AdminAuditEvent = {
      id: "governance:test",
      source: "governance",
      action: '=HYPERLINK("https://example.test")',
      actor: { uid: 1000, username: "admin", name: "Admin" },
      targetType: "site_settings",
      targetKey: "site",
      requestId: "request-1",
      detail: { safe: true },
      createdAt: new Date("2026-07-16T00:00:00.000Z"),
    };
    const csv = auditEventsToCsv([event]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('"{\"\"safe\"\":true}"');
  });
});
