import type { Metadata } from "next";
import { CommunityUiProvider } from "@/components/community/community-ui-provider.client";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header.client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getCurrentAccount } from "@/modules/identity/session.server";
import { runtimeEnv } from "@/shared/config/runtime-env";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL("https://github.com/Xwordsman/nextbuf"),
  title: {
    default: "NextBuf",
    template: "%s | NextBuf",
  },
  description: "面向 AI、建站、主机与域名话题的开源综合社区。",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const account = await getCurrentAccount();

  return (
    <html lang="zh-CN">
      <body>
        <TooltipProvider>
          <CommunityUiProvider>
            <div className="app-shell">
              <SiteHeader
                account={account}
                registrationOpen={runtimeEnv.AUTH_REGISTRATION_MODE !== "closed"}
              />
              <div className="page-frame">{children}</div>
              <SiteFooter />
            </div>
          </CommunityUiProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
