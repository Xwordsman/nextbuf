import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUniqueOrThrow: vi.fn(),
  profileUpsert: vi.fn(),
}));

vi.mock("@/infrastructure/database/client", () => ({
  getPrismaClient: () => ({
    user: { findUniqueOrThrow: mocks.findUniqueOrThrow },
    profile: { upsert: mocks.profileUpsert },
  }),
}));

import { getAccountProfile } from "@/modules/profiles/profile.server";

describe("account profile query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not write when the profile already exists", async () => {
    const user = {
      id: "user-1",
      profile: { userId: "user-1", bio: "现有资料" },
    };
    mocks.findUniqueOrThrow.mockResolvedValue(user);

    await expect(getAccountProfile(user.id)).resolves.toBe(user);
    expect(mocks.findUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(mocks.profileUpsert).not.toHaveBeenCalled();
  });

  it("self-heals a missing profile once before reading it again", async () => {
    const userId = "user-2";
    const repaired = { id: userId, profile: { userId, bio: null } };
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ id: userId, profile: null });
    mocks.findUniqueOrThrow.mockResolvedValueOnce(repaired);
    mocks.profileUpsert.mockResolvedValue({ userId });

    await expect(getAccountProfile(userId)).resolves.toBe(repaired);
    expect(mocks.profileUpsert).toHaveBeenCalledOnce();
    expect(mocks.profileUpsert).toHaveBeenCalledWith({
      where: { userId },
      create: { userId },
      update: {},
    });
    expect(mocks.findUniqueOrThrow).toHaveBeenCalledTimes(2);
  });
});
