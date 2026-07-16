import { z } from "zod";

const thresholdSchema = z.object({
  accountAgeDays: z.number().int().min(0),
  readTopics: z.number().int().min(0),
  posts: z.number().int().min(0),
  likesReceived: z.number().int().min(0),
  recentViolationsMax: z.number().int().min(0),
});

const trustRuleSchema = z
  .object({
    schemaVersion: z.literal(1),
    gracePeriodDays: z.number().int().min(0).max(90),
    violationWindowDays: z.number().int().min(1).max(730),
    levels: z.object({
      "1": thresholdSchema,
      "2": thresholdSchema,
      "3": thresholdSchema,
    }),
  })
  .superRefine((rule, context) => {
    for (const [lowerKey, higherKey] of [
      ["1", "2"],
      ["2", "3"],
    ] as const) {
      const lower = rule.levels[lowerKey];
      const higher = rule.levels[higherKey];
      for (const metric of ["accountAgeDays", "readTopics", "posts", "likesReceived"] as const) {
        if (higher[metric] < lower[metric]) {
          context.addIssue({
            code: "custom",
            path: ["levels", higherKey, metric],
            message: `TL${higherKey} cannot be easier than TL${lowerKey}`,
          });
        }
      }
      if (higher.recentViolationsMax > lower.recentViolationsMax) {
        context.addIssue({
          code: "custom",
          path: ["levels", higherKey, "recentViolationsMax"],
          message: `TL${higherKey} cannot allow more violations than TL${lowerKey}`,
        });
      }
    }
  });

export type TrustRuleConfig = z.infer<typeof trustRuleSchema>;
export type TrustMetrics = {
  accountAgeDays: number;
  readTopics: number;
  posts: number;
  likesReceived: number;
  recentViolations: number;
};

export type TrustCheck = {
  level: 1 | 2 | 3;
  met: boolean;
  requirements: TrustRuleConfig["levels"]["1"];
};

export type TrustEvaluation = {
  candidateLevel: 0 | 1 | 2 | 3;
  automatedLevel: 0 | 1 | 2 | 3;
  currentLevel: 0 | 1 | 2 | 3 | 4;
  graceUntil: Date | null;
  transition: "unchanged" | "promoted" | "grace_started" | "grace_active" | "demoted";
  checks: TrustCheck[];
};

export function parseTrustRuleConfig(value: unknown): TrustRuleConfig {
  return trustRuleSchema.parse(value);
}

function meetsThreshold(metrics: TrustMetrics, threshold: TrustRuleConfig["levels"]["1"]): boolean {
  return (
    metrics.accountAgeDays >= threshold.accountAgeDays &&
    metrics.readTopics >= threshold.readTopics &&
    metrics.posts >= threshold.posts &&
    metrics.likesReceived >= threshold.likesReceived &&
    metrics.recentViolations <= threshold.recentViolationsMax
  );
}

export function calculateAutomatedTrustLevel(
  metrics: TrustMetrics,
  rule: TrustRuleConfig,
): { level: 0 | 1 | 2 | 3; checks: TrustCheck[] } {
  const checks = ([1, 2, 3] as const).map((level) => {
    const requirements = rule.levels[String(level) as "1" | "2" | "3"];
    return { level, requirements, met: meetsThreshold(metrics, requirements) };
  });
  const level = checks.reduce<0 | 1 | 2 | 3>(
    (highest, check) => (check.met ? check.level : highest),
    0,
  );
  return { level, checks };
}

export function evaluateTrustTransition(input: {
  metrics: TrustMetrics;
  rule: TrustRuleConfig;
  previousAutomatedLevel: 0 | 1 | 2 | 3;
  manualLevel: 4 | null;
  graceUntil: Date | null;
  now: Date;
}): TrustEvaluation {
  const calculated = calculateAutomatedTrustLevel(input.metrics, input.rule);
  let automatedLevel = input.previousAutomatedLevel;
  let graceUntil = input.graceUntil;
  let transition: TrustEvaluation["transition"] = "unchanged";

  if (calculated.level >= input.previousAutomatedLevel) {
    automatedLevel = calculated.level;
    graceUntil = null;
    transition = calculated.level > input.previousAutomatedLevel ? "promoted" : "unchanged";
  } else if (!input.graceUntil) {
    transition = "grace_started";
    graceUntil = new Date(input.now.getTime() + input.rule.gracePeriodDays * 86_400_000);
    if (input.rule.gracePeriodDays === 0) {
      automatedLevel = calculated.level;
      graceUntil = null;
      transition = "demoted";
    }
  } else if (input.graceUntil > input.now) {
    transition = "grace_active";
  } else {
    automatedLevel = calculated.level;
    graceUntil = null;
    transition = "demoted";
  }

  return {
    candidateLevel: calculated.level,
    automatedLevel,
    currentLevel: input.manualLevel ?? automatedLevel,
    graceUntil,
    transition,
    checks: calculated.checks,
  };
}
