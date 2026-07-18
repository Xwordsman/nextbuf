import Link from "next/link";
import { GitFork, Heart, MessageSquare } from "lucide-react";
import { LegalAttribution } from "@/components/layout/legal-attribution";
import { PROJECT } from "@/shared/project";

const footerColumns = [
  {
    title: "项目",
    links: [
      { label: "源代码", href: PROJECT.repositoryUrl },
      {
        label: "开发路线",
        href: `${PROJECT.repositoryUrl}/blob/main/docs/09-detailed-development-plan.md`,
      },
      { label: "项目文档", href: `${PROJECT.repositoryUrl}/tree/main/docs` },
      { label: "AGPLv3 许可证", href: `${PROJECT.repositoryUrl}/blob/main/LICENSE` },
    ],
  },
  {
    title: "支持",
    links: [
      { label: "问题反馈", href: `${PROJECT.repositoryUrl}/issues` },
      { label: "安全政策", href: `${PROJECT.repositoryUrl}/security/policy` },
      { label: "服务存活状态", href: "/health/live" },
      { label: "版本信息", href: "/api/version" },
    ],
  },
] as const;

export function SiteFooter({ siteName = "NextBuf" }: { siteName?: string }) {
  return (
    <footer className="mt-[18px] border-t bg-background/75">
      <div className="mx-auto w-full max-w-[1380px] px-[18px] pt-7 pb-[18px] max-sm:px-3">
        <div className="grid grid-cols-[1.35fr_repeat(3,minmax(0,1fr))] gap-x-5 gap-y-6 max-[1024px]:grid-cols-[1.25fr_repeat(2,minmax(0,1fr))] max-[860px]:grid-cols-2 max-sm:grid-cols-1">
          <div className="min-w-0 max-[860px]:col-span-full max-sm:col-auto">
            <Link
              className="inline-flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              href="/"
              aria-label={`${siteName} 首页`}
            >
              <span
                className="grid size-[30px] shrink-0 place-items-center rounded-md bg-primary text-primary-foreground [&_svg]:size-[18px]"
                aria-hidden="true"
              >
                <MessageSquare />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <strong className="text-[15px] leading-none font-semibold">{siteName}</strong>
                <small className="truncate text-[11px] leading-tight text-muted-foreground">
                  AI · 建站 · 主机 · 域名
                </small>
              </span>
            </Link>
            <p className="mt-3.5 mb-2.5 max-w-[40ch] text-[13px] leading-6 text-muted-foreground">
              面向独立开发者和站长的开源综合社区程序，关注从想法、开发到部署和长期运营。
            </p>
            <a
              className="inline-flex items-center gap-1.5 rounded-sm text-xs font-semibold text-foreground/75 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href={PROJECT.repositoryUrl}
            >
              <GitFork className="size-3.5" aria-hidden="true" /> Xwordsman/nextbuf
            </a>
          </div>

          {footerColumns.map((column) => (
            <div className="min-w-0" key={column.title}>
              <h2 className="mt-0.5 mb-3 text-[13px] font-semibold">{column.title}</h2>
              <nav className="grid gap-2.5" aria-label={`${column.title}链接`}>
                {column.links.map((link) => (
                  <a
                    className="w-fit rounded-sm text-[13px] text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    href={link.href}
                    key={link.label}
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
            </div>
          ))}

          <div className="min-w-0 max-[1024px]:col-span-full max-sm:col-auto">
            <h2 className="mt-0.5 mb-3 text-[13px] font-semibold">社区方向</h2>
            <p className="mt-0 mb-2.5 max-w-[40ch] text-[13px] leading-6 text-muted-foreground">
              人工智能、建站开发、主机云服务、域名 DNS 和运维网络。
            </p>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/75">
              <Heart className="size-3.5" aria-hidden="true" /> 自用优先，持续开源
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t pt-4 max-sm:items-start">
          <div>
            <p className="m-0 text-xs leading-5 text-muted-foreground">
              © 2026 {siteName} 开源社区项目
            </p>
            <p className="m-0 text-xs leading-5 text-muted-foreground">
              AGPL-3.0-only · DCO 1.1 · v{PROJECT.version}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <LegalAttribution />
            <a
              className="rounded-sm font-medium text-foreground/75 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              href={`${PROJECT.repositoryUrl}/blob/main/NOTICE`}
            >
              署名政策
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
