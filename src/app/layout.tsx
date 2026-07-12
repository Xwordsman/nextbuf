import type { Metadata } from "next";
import Link from "next/link";
import { LegalAttribution } from "@/components/layout/legal-attribution";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://github.com/Xwordsman/nextbuf"),
  title: {
    default: "NextBuf",
    template: "%s | NextBuf",
  },
  description: "面向 AI、建站、主机与域名话题的开源综合社区。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <header className="site-header">
            <Link className="brand" href="/" aria-label="NextBuf 首页">
              NextBuf
            </Link>
            <span className="milestone">v0.2.0 运行时基础</span>
          </header>
          <div className="page-frame">{children}</div>
          <LegalAttribution />
        </div>
      </body>
    </html>
  );
}
