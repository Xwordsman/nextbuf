"use client";

import {
  Activity,
  ArrowUpRight,
  FileSearch,
  Gavel,
  LayoutDashboard,
  Network,
  ScrollText,
  ServerCog,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/shadcn/ui/breadcrumb";
import { Separator } from "@/components/shadcn/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/shadcn/ui/sidebar";
import { TooltipProvider } from "@/components/shadcn/ui/tooltip";

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
  adminOnly?: boolean;
  items: readonly AdminNavigationItem[];
};

const adminNavigation: readonly AdminNavigationGroup[] = [
  {
    key: "overview",
    label: "概览",
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
    .filter((group) => group.key !== "moderation" || canModerate);
  const currentGroup =
    groups.find((group) => group.items.some((item) => isCurrentItem(item, pathname))) ?? groups[0];
  const currentItem = currentGroup?.items.find((item) => isCurrentItem(item, pathname));

  return (
    <TooltipProvider>
      <SidebarProvider>
        <a className="skip-link" href="#admin-main-content">
          跳到后台主要内容
        </a>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="lg" tooltip="NextBuf 管理后台">
                  <Link href="/admin">
                    <span className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                      <Activity aria-hidden="true" />
                    </span>
                    <span className="grid flex-1 text-left leading-tight">
                      <span className="truncate font-semibold">NextBuf</span>
                      <span className="truncate text-xs text-sidebar-foreground/70">管理后台</span>
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <nav aria-label="后台导航" id="admin-primary-navigation">
              {groups.map((group) => (
                <SidebarGroup key={group.key}>
                  <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = isCurrentItem(item, pathname);
                        return (
                          <SidebarMenuItem key={item.href}>
                            <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                              <Link href={item.href} aria-current={active ? "page" : undefined}>
                                <Icon aria-hidden="true" />
                                <span>{item.label}</span>
                              </Link>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </nav>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="返回社区">
                  <Link href="/">
                    <ArrowUpRight aria-hidden="true" />
                    <span>返回社区</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset id="admin-main-content" tabIndex={-1}>
          <header className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
            <SidebarTrigger aria-controls="admin-primary-navigation" aria-label="切换后台导航" />
            <Separator orientation="vertical" className="h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink asChild>
                    <Link href="/admin">管理后台</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                {currentGroup ? (
                  <>
                    <BreadcrumbItem>
                      <span>{currentGroup.label}</span>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </>
                ) : null}
                <BreadcrumbItem>
                  <BreadcrumbPage>{currentItem?.label ?? "管理后台"}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            {currentItem ? (
              <p className="ml-auto hidden max-w-md truncate text-sm text-muted-foreground lg:block">
                {currentItem.description}
              </p>
            ) : null}
          </header>
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
