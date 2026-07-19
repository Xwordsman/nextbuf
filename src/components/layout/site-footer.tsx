import { LegalAttribution } from "@/components/layout/legal-attribution";
import { PROJECT } from "@/shared/project";

const footerLinks = [
  { label: "源代码", href: PROJECT.repositoryUrl },
  { label: "项目文档", href: `${PROJECT.repositoryUrl}/tree/main/docs` },
  { label: "问题反馈", href: `${PROJECT.repositoryUrl}/issues` },
  { label: "安全政策", href: `${PROJECT.repositoryUrl}/security/policy` },
  { label: "署名政策", href: `${PROJECT.repositoryUrl}/blob/main/NOTICE` },
] as const;

export function SiteFooter({ siteName = "NextBuf" }: { siteName?: string }) {
  return (
    <footer className="mt-[18px] border-t bg-background" data-testid="site-footer">
      <div className="mx-auto w-full max-w-[1380px] px-[18px] py-5 max-sm:px-3 max-sm:py-4">
        <nav
          aria-label="页脚链接"
          className="flex flex-wrap items-center gap-y-1 text-xs leading-5 text-muted-foreground"
        >
          {footerLinks.map((link, index) => (
            <span className="inline-flex items-center gap-x-2.5" key={link.label}>
              <a
                className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                href={link.href}
              >
                {link.label}
              </a>
              {index < footerLinks.length - 1 ? <span aria-hidden="true">·</span> : null}
            </span>
          ))}
        </nav>

        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          面向 AI、建站、主机与域名话题的开源社区。
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs leading-5 text-muted-foreground">
          <span>© 2026 {siteName}</span>
          <span aria-hidden="true">·</span>
          <LegalAttribution />
          <span aria-hidden="true">·</span>
          <a
            className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            href={`${PROJECT.repositoryUrl}/blob/main/LICENSE`}
          >
            AGPL-3.0-only
          </a>
          <span aria-hidden="true">·</span>
          <span>v{PROJECT.version}</span>
        </div>
      </div>
    </footer>
  );
}
