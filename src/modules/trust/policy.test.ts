import { describe, expect, it } from "vitest";
import {
  calculateAutomatedTrustLevel,
  evaluateTrustTransition,
  parseTrustRuleConfig,
  type TrustMetrics,
} from "@/modules/trust/policy";

const rule = parseTrustRuleConfig({
  schemaVersion: 1,
  gracePeriodDays: 14,
  violationWindowDays: 180,
  levels: {
    "1": { accountAgeDays: 1, readTopics: 3, posts: 1, likesReceived: 0, recentViolationsMax: 0 },
    "2": {
      accountAgeDays: 14,
      readTopics: 20,
      posts: 10,
      likesReceived: 3,
      recentViolationsMax: 0,
    },
    "3": {
      accountAgeDays: 60,
      readTopics: 100,
      posts: 50,
      likesReceived: 20,
      recentViolationsMax: 0,
    },
  },
});

const tl3Metrics: TrustMetrics = {
  accountAgeDays: 90,
  readTopics: 120,
  posts: 70,
  likesReceived: 30,
  recentViolations: 0,
};

describe("trust policy", () => {
  it("selects the highest fully satisfied automatic level", () => {
    expect(calculateAutomatedTrustLevel(tl3Metrics, rule).level).toBe(3);
    expect(calculateAutomatedTrustLevel({ ...tl3Metrics, readTopics: 19 }, rule).level).toBe(1);
    expect(calculateAutomatedTrustLevel({ ...tl3Metrics, recentViolations: 1 }, rule).level).toBe(
      0,
    );
  });

  it("promotes immediately and keeps manual TL4 separate", () => {
    const result = evaluateTrustTransition({
      metrics: tl3Metrics,
      rule,
      previousAutomatedLevel: 1,
      manualLevel: 4,
      graceUntil: null,
      now: new Date("2026-07-16T00:00:00Z"),
    });
    expect(result.automatedLevel).toBe(3);
    expect(result.currentLevel).toBe(4);
    expect(result.transition).toBe("promoted");
  });

  it("starts and later completes a demotion grace period", () => {
    const now = new Date("2026-07-16T00:00:00Z");
    const first = evaluateTrustTransition({
      metrics: { ...tl3Metrics, recentViolations: 1 },
      rule,
      previousAutomatedLevel: 3,
      manualLevel: null,
      graceUntil: null,
      now,
    });
    expect(first.automatedLevel).toBe(3);
    expect(first.transition).toBe("grace_started");

    const final = evaluateTrustTransition({
      metrics: { ...tl3Metrics, recentViolations: 1 },
      rule,
      previousAutomatedLevel: 3,
      manualLevel: null,
      graceUntil: new Date("2026-07-15T00:00:00Z"),
      now,
    });
    expect(final.automatedLevel).toBe(0);
    expect(final.transition).toBe("demoted");
    expect(final.graceUntil).toBeNull();
  });

  it("rejects a higher level that is easier than a lower level", () => {
    expect(() =>
      parseTrustRuleConfig({
        ...rule,
        levels: { ...rule.levels, "2": { ...rule.levels["2"], posts: 0 } },
      }),
    ).toThrow();
  });
});
