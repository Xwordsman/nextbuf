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

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link className="site-brand" href="/" aria-label="NextBuf 首页">
              <span className="brand-mark" aria-hidden="true">
                <MessageSquare />
              </span>
              <span className="brand-copy">
                <strong>NextBuf</strong>
                <small>AI · 建站 · 主机 · 域名</small>
              </span>
            </Link>
            <p>面向独立开发者和站长的开源综合社区程序，关注从想法、开发到部署和长期运营。</p>
            <a className="footer-repository" href={PROJECT.repositoryUrl}>
              <GitFork aria-hidden="true" /> Xwordsman/nextbuf
            </a>
          </div>

          {footerColumns.map((column) => (
            <div className="footer-column" key={column.title}>
              <h2>{column.title}</h2>
              <nav aria-label={`${column.title}链接`}>
                {column.links.map((link) => (
                  <a href={link.href} key={link.label}>
                    {link.label}
                  </a>
                ))}
              </nav>
            </div>
          ))}

          <div className="footer-column footer-focus">
            <h2>社区方向</h2>
            <p>人工智能、建站开发、主机云服务、域名 DNS 和运维网络。</p>
            <span className="footer-note">
              <Heart aria-hidden="true" /> 自用优先，持续开源
            </span>
          </div>
        </div>

        <div className="footer-bottom">
          <div>
            <p>© 2026 NextBuf 开源社区项目</p>
            <p>AGPL-3.0-only · DCO 1.1 · v0.3.0</p>
          </div>
          <div className="footer-bottom-links">
            <LegalAttribution />
            <a href={`${PROJECT.repositoryUrl}/blob/main/NOTICE`}>署名政策</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
