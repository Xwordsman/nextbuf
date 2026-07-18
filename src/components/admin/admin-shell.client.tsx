"use client";

import {
  Activity,
  ArrowUpRight,
  ChevronRight,
  FileSearch,
  Gavel,
  LayoutDashboard,
  Network,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type AdminNavigationItem = {
  href: string;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

type AdminNavigationGroup = {
  key: "overview" | "community" | "moderation" | "operations" | "system";
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  items: readonly AdminNavigationItem[];
};

const adminNavigation: readonly AdminNavigationGroup[] = [
  {
    key: "overview",
    label: "概览",
    icon: LayoutDashboard,
    items: [
      {
        href: "/admin",
        label: "仪表盘",
        description: "站点指标、运行告警和待处理事项。",
        icon: LayoutDashboard,
        exact: true,
      },
    ],
  },
  {
    key: "community",
    label: "社区",
    icon: Users,
    adminOnly: true,
    items: [
      {
        href: "/admin/users",
        label: "用户管理",
        description: "用户列表、资料、角色、会话与制裁。",
        icon: Users,
      },
      {
        href: "/admin/content/topics",
        label: "主题管理",
        description: "主题列表、筛选与内容处置入口。",
        icon: FileSearch,
      },
      {
        href: "/admin/content/replies",
        label: "回复管理",
        description: "回复列表、筛选与内容处置入口。",
        icon: FileSearch,
      },
      {
        href: "/admin/nodes",
        label: "节点管理",
        description: "节点列表、新建、编辑与归档。",
        icon: Network,
      },
    ],
  },
  {
    key: "moderation",
    label: "治理",
    icon: Gavel,
    items: [
      {
        href: "/admin/moderation",
        label: "治理案件",
        description: "举报、处置、制裁和案件流转。",
        icon: Gavel,
      },
    ],
  },
  {
    key: "operations",
    label: "运维",
    icon: ServerCog,
    adminOnly: true,
    items: [
      {
        href: "/admin/worker",
        label: "Worker 运维",
        description: "队列、Outbox、邮件、重放和运行诊断。",
        icon: ServerCog,
      },
    ],
  },
  {
    key: "system",
    label: "系统",
    icon: Settings,
    adminOnly: true,
    items: [
      {
        href: "/admin/settings",
        label: "站点设置",
        description: "注册策略、内容开关和站点运营规则。",
        icon: Settings,
        exact: true,
      },
      {
        href: "/admin/settings/providers",
        label: "Provider 诊断",
        description: "邮件、存储和 GitHub OAuth 的脱敏状态与连接测试。",
        icon: ServerCog,
      },
      {
        href: "/admin/settings/trust",
        label: "信任规则",
        description: "信任规则草稿、预览、激活与批次状态。",
        icon: ShieldCheck,
      },
      {
        href: "/admin/audit",
        label: "审计日志",
        description: "身份、社区和治理操作记录。",
        icon: ScrollText,
      },
    ],
  },
];

function isCurrentItem(item: AdminNavigationItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

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
  const groups = adminNavigation
    .filter((group) => !group.adminOnly || isAdmin)
    .filter((group) => {
      return group.key !== "moderation" || canModerate;
    });
  const currentGroup =
    groups.find((group) => group.items.some((item) => isCurrentItem(item, pathname))) ?? groups[0];
  const currentItem = currentGroup?.items.find((item) => isCurrentItem(item, pathname));

  return (
    <div className="admin-shell">
      <aside className="admin-primary-sidebar" aria-label="后台一级导航">
        <Link className="admin-brand-mark" href="/admin" title="管理后台" aria-label="管理后台">
          <Activity aria-hidden="true" />
        </Link>
        <nav className="admin-primary-nav" aria-label="后台模块">
          {groups.map((group) => {
            const Icon = group.icon;
            const active = group.key === currentGroup?.key;
            return (
              <Link
                key={group.key}
                href={group.items[0]!.href}
                aria-current={active ? "page" : undefined}
                aria-label={group.label}
                title={group.label}
              >
                <Icon aria-hidden="true" />
                <span>{group.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <aside className="admin-secondary-sidebar" aria-label="后台二级导航">
        <div className="admin-secondary-heading">
          <span>{currentGroup?.label}</span>
          <small>{isAdmin ? "站点管理员" : "内容治理"}</small>
        </div>
        <nav className="admin-secondary-nav" aria-label={`${currentGroup?.label ?? "后台"}功能`}>
          {currentGroup?.items.map((item) => {
            const Icon = item.icon;
            const active = isCurrentItem(item, pathname);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="admin-secondary-footer">
          <Link href="/">
            <ArrowUpRight aria-hidden="true" />
            返回社区
          </Link>
        </div>
      </aside>

      <div className="admin-content">
        <header className="admin-topbar">
          <div className="admin-breadcrumb" aria-label="当前位置">
            <ShieldCheck aria-hidden="true" />
            <span>管理后台</span>
            <ChevronRight aria-hidden="true" />
            <span>{currentGroup?.label}</span>
            {currentItem ? (
              <>
                <ChevronRight aria-hidden="true" />
                <strong>{currentItem.label}</strong>
              </>
            ) : null}
          </div>
          <span className="admin-topbar-description">{currentItem?.description}</span>
        </header>
        {children}
      </div>
    </div>
  );
}
