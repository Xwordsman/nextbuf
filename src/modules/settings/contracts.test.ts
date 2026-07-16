import { describe, expect, it } from "vitest";
import { siteSettingsInputSchema } from "@/modules/settings/contracts";

describe("site settings contract", () => {
  it("accepts bounded operational settings", () => {
    expect(
      siteSettingsInputSchema.parse({
        siteName: "NextBuf Community",
        registrationMode: "invite",
        topicsEnabled: true,
        repliesEnabled: false,
        uploadsEnabled: true,
        maxTopicsPerHour: 5,
        maxRepliesPerHour: 40,
        maxUploadsPerHour: 10,
      }),
    ).toMatchObject({ registrationMode: "invite", maxRepliesPerHour: 40 });
  });

  it("rejects unbounded limits and unknown fields", () => {
    expect(() =>
      siteSettingsInputSchema.strict().parse({
        siteName: "N",
        registrationMode: "open",
        topicsEnabled: true,
        repliesEnabled: true,
        uploadsEnabled: true,
        maxTopicsPerHour: 0,
        maxRepliesPerHour: 501,
        maxUploadsPerHour: 201,
        arbitrary: true,
      }),
    ).toThrow();
  });
});
