import type { Metadata } from "next";
import { cache } from "react";
import { CommunityUiProvider } from "@/components/community/community-ui-provider.client";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header.client";
import { TooltipProvider } from "@/components/shadcn/ui/tooltip";
import { getCurrentAccount } from "@/modules/identity/session.server";
import { getSiteSettings } from "@/modules/settings/settings.server";
import { runtimeEnv } from "@/shared/config/runtime-env";
import "./globals.css";

export const dynamic = "force-dynamic";

const getLayoutSiteSettings = cache(async () =>
  runtimeEnv.NODE_ENV === "development" && !process.env.DATABASE_URL
    ? { siteName: "NextBuf", registrationMode: runtimeEnv.AUTH_REGISTRATION_MODE }
    : getSiteSettings(),
);

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getLayoutSiteSettings();
  return {
    metadataBase: new URL("https://github.com/Xwordsman/nextbuf"),
    title: { default: settings.siteName, template: `%s | ${settings.siteName}` },
    description: "面向 AI、建站、主机与域名话题的开源综合社区。",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const account = await getCurrentAccount();
  const settings = await getLayoutSiteSettings();

  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <TooltipProvider>
          <CommunityUiProvider>
            <div className="grid min-h-screen grid-rows-[auto_1fr_auto]">
              <a
                className="fixed top-2 left-2 z-[100] -translate-y-[calc(100%+1rem)] rounded-md border bg-background px-3 py-2 text-sm font-medium whitespace-nowrap shadow-md outline-none transition-transform focus:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                href="#main-content"
              >
                跳到主要内容
              </a>
              <SiteHeader
                account={account}
                siteName={settings.siteName}
                registrationOpen={settings.registrationMode !== "closed"}
              />
              <div id="main-content" className="w-full min-w-0 outline-none" tabIndex={-1}>
                {children}
              </div>
              <SiteFooter siteName={settings.siteName} />
            </div>
          </CommunityUiProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
