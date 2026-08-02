import { describe, expect, it } from "vitest";
import {
  isAccountTombstoneEmail,
  isAccountTombstoneUsername,
} from "@/modules/identity/account-tombstone-policy";

describe("account tombstone namespace policy", () => {
  it("reserves the internal tombstone email domain case-insensitively", () => {
    expect(isAccountTombstoneEmail("deleted+id@deleted.invalid")).toBe(true);
    expect(isAccountTombstoneEmail("user@DELETED.INVALID")).toBe(true);
    expect(isAccountTombstoneEmail("user@example.com")).toBe(false);
    expect(isAccountTombstoneEmail("user@sub.deleted.invalid")).toBe(false);
  });

  it("reserves every generated tombstone username", () => {
    expect(isAccountTombstoneUsername("deleted-1")).toBe(true);
    expect(isAccountTombstoneUsername(" Deleted-42-abc ")).toBe(true);
    expect(isAccountTombstoneUsername("deleted_user")).toBe(false);
  });
});
