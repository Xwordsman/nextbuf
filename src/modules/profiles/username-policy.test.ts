import { describe, expect, it } from "vitest";
import {
  normalizeUsername,
  usernameCooldownEnds,
  validateUsername,
} from "@/modules/profiles/username-policy";

describe("username policy", () => {
  it("normalizes valid ASCII usernames", () => {
    expect(normalizeUsername("  Alice_01 ")).toBe("alice_01");
    expect(validateUsername("Alice_01")).toEqual({ ok: true, username: "alice_01" });
  });

  it("rejects ambiguous, malformed and reserved usernames", () => {
    expect(validateUsername("ab")).toMatchObject({ ok: false, code: "invalid_username" });
    expect(validateUsername("1alice")).toMatchObject({ ok: false, code: "invalid_username" });
    expect(validateUsername("alice__dev")).toMatchObject({ ok: false, code: "invalid_username" });
    expect(validateUsername("管理员")).toMatchObject({ ok: false, code: "invalid_username" });
    expect(validateUsername("admin")).toMatchObject({ ok: false, code: "reserved_username" });
  });

  it("uses a thirty day change cooldown", () => {
    expect(usernameCooldownEnds(new Date("2026-01-01T00:00:00.000Z")).toISOString()).toBe(
      "2026-01-31T00:00:00.000Z",
    );
  });
});
