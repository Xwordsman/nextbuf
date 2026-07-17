import type { Metadata } from "next";
import { cache } from "react";
import { CommunityUiProvider } from "@/components/community/community-ui-provider.client";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header.client";
import { TooltipProvider } from "@/components/ui/tooltip";
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
      <body>
        <TooltipProvider>
          <CommunityUiProvider>
            <div className="app-shell">
              <a className="skip-link" href="#main-content">
                跳到主要内容
              </a>
              <SiteHeader
                account={account}
                siteName={settings.siteName}
                registrationOpen={settings.registrationMode !== "closed"}
              />
              <div id="main-content" className="page-frame" tabIndex={-1}>
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
