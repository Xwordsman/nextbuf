"use client";

import {
  Activity,
  FileSearch,
  Gavel,
  LayoutDashboard,
  Network,
  ScrollText,
  ServerCog,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const adminItems = [
  { href: "/admin", label: "仪表盘", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "用户", icon: Users },
  { href: "/admin/content", label: "内容", icon: FileSearch },
  { href: "/admin/nodes", label: "节点", icon: Network },
  { href: "/admin/settings", label: "站点设置", icon: Settings },
  { href: "/admin/audit", label: "审计日志", icon: ScrollText },
  { href: "/admin/worker", label: "Worker", icon: ServerCog },
] as const;

export function AdminShell({
  children,
  isAdmin,
  canModerate,
}: {
  children: React.ReactNode;
  isAdmin: boolean;
  canModerate: boolean;
}) {
  const pathname = usePathname();
  const items = [
    ...(isAdmin ? adminItems : []),
    ...(canModerate
      ? [{ href: "/admin/moderation", label: "治理案件", icon: Gavel, exact: false }]
      : []),
  ];
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-title">
          <Activity aria-hidden="true" />
          <div>
            <strong>管理后台</strong>
            <span>{isAdmin ? "站点管理员" : "内容治理"}</span>
          </div>
        </div>
        <nav aria-label="管理后台导航">
          {items.map((item) => {
            const active =
              "exact" in item && item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
                <Icon aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="admin-content">{children}</div>
    </div>
  );
}
