import { describe, expect, it } from "vitest";
import { calculateHotScore, HOT_SIGNAL_CAPS } from "@/modules/interactions/hot-score";

const now = new Date("2026-07-16T12:00:00.000Z");

function score(overrides: Partial<Parameters<typeof calculateHotScore>[0]> = {}) {
  return calculateHotScore(
    {
      publishedAt: new Date("2026-07-16T06:00:00.000Z"),
      replyCount: 0,
      participantCount: 0,
      likeCount: 0,
      bookmarkCount: 0,
      viewCount: 0,
      ...overrides,
    },
    now,
  );
}

describe("hot score v1", () => {
  it("rewards independent participation more than repeated raw views", () => {
    expect(score({ participantCount: 5, replyCount: 5 })).toBeGreaterThan(
      score({ viewCount: 500 }),
    );
  });

  it("applies time decay", () => {
    expect(score()).toBeGreaterThan(score({ publishedAt: new Date("2026-07-10T06:00:00.000Z") }));
  });

  it("caps each manipulation-sensitive signal", () => {
    expect(score({ replyCount: HOT_SIGNAL_CAPS.replies })).toBe(
      score({ replyCount: HOT_SIGNAL_CAPS.replies * 100 }),
    );
    expect(score({ viewCount: HOT_SIGNAL_CAPS.views })).toBe(
      score({ viewCount: HOT_SIGNAL_CAPS.views * 100 }),
    );
  });
});
