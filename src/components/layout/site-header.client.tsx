"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Bell,
  Bookmark,
  FileText,
  LogIn,
  LogOut,
  MessageSquare,
  PanelRight,
  Search,
  ServerCog,
  Settings,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  UserRound,
} from "lucide-react";
import { authClient } from "@/components/auth/auth-client";
import { useEffect } from "react";
import { useCommunityUi } from "@/components/community/community-ui-provider.client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/ui/dropdown-menu";
import { Input } from "@/components/shadcn/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/ui/tooltip";

type SiteHeaderProps = {
  account: {
    name: string;
    username: string;
    uid: number;
    trustLevel: number;
    email: string;
    image: string | null;
    initials: string;
    unreadNotifications: number;
    isAdmin: boolean;
    canModerate: boolean;
  } | null;
  siteName: string;
  registrationOpen: boolean;
};

export function SiteHeader({ account, siteName, registrationOpen }: SiteHeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { query, setQuery, mobileSearchOpen, setMobileSearchOpen, setRailOpen } = useCommunityUi();
  const routedQuery = pathname === "/search" ? (searchParams.get("q") ?? "") : "";
  const hasCommunityPanel =
    pathname === "/" || pathname.startsWith("/nodes/") || /^\/topics\/\d+$/.test(pathname);
  useEffect(() => {
    if (pathname === "/search") setQuery(routedQuery);
  }, [pathname, routedQuery, setQuery]);
  const signOut = async () => {
    await authClient.signOut();
    window.location.assign("/");
  };

  return (
    <header
      className="sticky top-0 z-[60] min-h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      data-testid="site-header"
    >
      <div className="mx-auto grid min-h-14 w-full max-w-[1380px] grid-cols-[auto_minmax(240px,520px)_auto] items-center gap-[18px] px-[18px] max-[860px]:grid-cols-[auto_minmax(160px,1fr)_auto] max-sm:grid-cols-[auto_1fr] max-sm:gap-2.5 max-sm:px-3">
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
            <small className="truncate text-[11px] leading-tight text-muted-foreground max-sm:hidden">
              AI · 建站 · 主机 · 域名
            </small>
          </span>
        </Link>

        <form className="relative block w-full max-sm:hidden" action="/search" role="search">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <label className="sr-only" htmlFor="desktop-search">
            搜索话题、节点或作者
          </label>
          <Input
            id="desktop-search"
            name="q"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索话题、节点或作者..."
            autoComplete="off"
            className="h-8 rounded-lg bg-muted/45 pl-8 shadow-none focus-visible:bg-background"
          />
        </form>

        <div className="flex items-center justify-end gap-1.5 max-sm:gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="hidden max-sm:inline-flex"
                type="button"
                variant="ghost"
                size="icon"
                aria-label="搜索"
                aria-expanded={mobileSearchOpen}
                onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
              >
                <Search />
              </Button>
            </TooltipTrigger>
            <TooltipContent sideOffset={6}>搜索</TooltipContent>
          </Tooltip>

          {hasCommunityPanel ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  className="hidden max-[1100px]:inline-flex"
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="我的面板"
                  onClick={() => setRailOpen(true)}
                >
                  <PanelRight />
                </Button>
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>我的面板</TooltipContent>
            </Tooltip>
          ) : null}

          {account ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild variant="ghost" size="icon" className="relative">
                    <Link
                      href="/notifications"
                      aria-label={
                        account.unreadNotifications > 0
                          ? `通知，${account.unreadNotifications} 条未读`
                          : "通知"
                      }
                    >
                      <Bell />
                      {account.unreadNotifications > 0 ? (
                        <span
                          className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full border-2 border-background bg-blue-600 px-1 text-[9px] font-bold leading-none text-white"
                          aria-hidden="true"
                        >
                          {account.unreadNotifications > 99 ? "99+" : account.unreadNotifications}
                        </span>
                      ) : null}
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent sideOffset={6}>通知</TooltipContent>
              </Tooltip>

              <Button asChild>
                <Link href="/topics/new" aria-label="发帖">
                  <FileText />
                  <span className="max-sm:hidden">发帖</span>
                </Link>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 overflow-hidden rounded-full border border-border bg-background p-0 hover:border-foreground/35 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=open]:border-foreground/35"
                    aria-label="账户菜单"
                  >
                    <Avatar className="size-full border-0">
                      <AvatarImage src={account.image ?? undefined} alt={account.name} />
                      <AvatarFallback>{account.initials}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64" align="end">
                  <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2">
                    <Avatar className="size-11">
                      <AvatarImage src={account.image ?? undefined} alt={account.name} />
                      <AvatarFallback>{account.initials}</AvatarFallback>
                    </Avatar>
                    <span className="grid min-w-0 flex-1 gap-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <strong className="truncate text-sm font-semibold text-foreground">
                          {account.name}
                        </strong>
                        <span className="truncate text-xs font-medium text-muted-foreground">
                          @{account.username}
                        </span>
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <span>UID {account.uid}</span>
                        <Badge
                          variant="secondary"
                          className="h-5 rounded-md px-1.5 text-[10px] font-semibold"
                        >
                          TL{account.trustLevel}
                        </Badge>
                      </span>
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem asChild>
                      <Link href={`/u/${account.username}`}>
                        <UserRound /> 个人主页
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/notifications">
                        <Bell /> 通知中心
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/account">
                        <Settings /> 账户设置
                      </Link>
                    </DropdownMenuItem>
                    {account.isAdmin ? (
                      <DropdownMenuItem asChild>
                        <Link href="/admin">
                          <ServerCog /> 管理后台
                        </Link>
                      </DropdownMenuItem>
                    ) : null}
                    {account.canModerate ? (
                      <DropdownMenuItem asChild>
                        <Link href="/admin/moderation">
                          <ShieldAlert /> 治理案件
                        </Link>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem asChild>
                      <Link href="/account/security">
                        <ShieldCheck /> 账号安全
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/account/topics">
                        <FileText /> 我的话题
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/account/bookmarks">
                        <Bookmark /> 我的收藏
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}>
                    <LogOut /> 退出登录
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="flex items-center gap-1.5 max-sm:gap-0.5">
              <Button asChild variant="outline" aria-label="登录">
                <Link href="/auth/sign-in">
                  <LogIn /> <span className="max-sm:hidden">登录</span>
                </Link>
              </Button>
              {registrationOpen ? (
                <Button asChild aria-label="注册">
                  <Link href="/auth/sign-up">
                    <UserPlus /> <span className="max-sm:hidden">注册</span>
                  </Link>
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {mobileSearchOpen ? (
        <div className="mx-auto hidden w-full max-w-[1380px] px-3 pb-2.5 max-sm:block">
          <form action="/search" role="search" className="relative block w-full">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <label className="sr-only" htmlFor="mobile-search">
              搜索话题、节点或作者
            </label>
            <Input
              id="mobile-search"
              name="q"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索话题、节点或作者..."
              autoFocus
              className="h-9 rounded-lg bg-muted/45 pl-8 shadow-none focus-visible:bg-background"
            />
          </form>
        </div>
      ) : null}
    </header>
  );
}
