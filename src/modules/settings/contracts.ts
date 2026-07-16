import { z } from "zod";

export const SITE_SETTINGS_ID = "site";

export const siteSettingsInputSchema = z.object({
  siteName: z.string().trim().min(2).max(80),
  registrationMode: z.enum(["open", "invite", "closed"]),
  topicsEnabled: z.boolean(),
  repliesEnabled: z.boolean(),
  uploadsEnabled: z.boolean(),
  maxTopicsPerHour: z.number().int().min(1).max(100),
  maxRepliesPerHour: z.number().int().min(1).max(500),
  maxUploadsPerHour: z.number().int().min(1).max(200),
});

export type SiteSettingsInput = z.infer<typeof siteSettingsInputSchema>;

export const defaultSiteSettings: SiteSettingsInput = {
  siteName: "NextBuf",
  registrationMode: "open",
  topicsEnabled: true,
  repliesEnabled: true,
  uploadsEnabled: true,
  maxTopicsPerHour: 3,
  maxRepliesPerHour: 20,
  maxUploadsPerHour: 20,
};
