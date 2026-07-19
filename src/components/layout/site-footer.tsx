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
    <footer className="mt-[18px] border-t border-border/80 bg-card" data-testid="site-footer">
      <div className="mx-auto w-full max-w-[1380px] px-[18px] pt-5 pb-6 max-sm:px-3 max-sm:pt-4 max-sm:pb-5">
        <nav
          aria-label="页脚链接"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-muted-foreground"
        >
          {footerLinks.map((link, index) => (
            <span className="inline-flex items-center gap-x-3" key={link.label}>
              <a
                className="rounded-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                href={link.href}
              >
                {link.label}
              </a>
              {index < footerLinks.length - 1 ? <span aria-hidden="true">·</span> : null}
            </span>
          ))}
        </nav>

        <p
          className="mt-5 text-[13px] leading-5 text-muted-foreground"
          data-testid="footer-tagline"
        >
          独立开发者与站长的社区
        </p>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
          Build quietly, share openly.
        </p>

        <div
          className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-muted-foreground"
          data-testid="footer-runtime"
        >
          <span className="inline-flex items-center gap-x-2">
            <span>VERSION: {PROJECT.version}</span>
            <span aria-hidden="true">·</span>
          </span>
          <span className="inline-flex items-center gap-x-2">
            <span>© 2026 {siteName}</span>
            <span aria-hidden="true">·</span>
          </span>
          <span className="inline-flex items-center gap-x-2">
            <LegalAttribution />
            <span aria-hidden="true">·</span>
          </span>
          <a
            className="rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            href={`${PROJECT.repositoryUrl}/blob/main/LICENSE`}
          >
            AGPL-3.0-only
          </a>
        </div>
      </div>
    </footer>
  );
}
