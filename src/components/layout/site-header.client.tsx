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
  Settings,
  ShieldCheck,
  UserPlus,
  UserRound,
} from "lucide-react";
import { authClient } from "@/components/auth/auth-client";
import { useEffect } from "react";
import { useCommunityUi } from "@/components/community/community-ui-provider.client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";

type SiteHeaderProps = {
  account: {
    name: string;
    username: string;
    uid: number;
    trustLevel: number;
    email: string;
    image: string | null;
    initials: string;
  } | null;
  registrationOpen: boolean;
};

export function SiteHeader({ account, registrationOpen }: SiteHeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { query, setQuery, mobileSearchOpen, setMobileSearchOpen, setRailOpen } = useCommunityUi();
  const routedQuery = pathname === "/search" ? (searchParams.get("q") ?? "") : "";
  useEffect(() => {
    if (pathname === "/search") setQuery(routedQuery);
  }, [pathname, routedQuery, setQuery]);
  const signOut = async () => {
    await authClient.signOut();
    window.location.assign("/");
  };

  return (
    <header className="site-header" data-testid="site-header">
      <div className="header-inner">
        <Link className="site-brand" href="/" aria-label="NextBuf 首页">
          <span className="brand-mark" aria-hidden="true">
            <MessageSquare />
          </span>
          <span className="brand-copy">
            <strong>NextBuf</strong>
            <small>AI · 建站 · 主机 · 域名</small>
          </span>
        </Link>

        <form className="header-search" action="/search" role="search">
          <Search aria-hidden="true" />
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
          />
        </form>

        <div className="header-actions">
          <Tooltip content="搜索">
            <Button
              className="mobile-search-trigger"
              type="button"
              variant="ghost"
              size="icon"
              aria-label="搜索"
              aria-expanded={mobileSearchOpen}
              onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
            >
              <Search />
            </Button>
          </Tooltip>

          {pathname === "/" || pathname.startsWith("/nodes/") ? (
            <Tooltip content="我的面板">
              <Button
                className="mobile-rail-trigger"
                type="button"
                variant="ghost"
                size="icon"
                aria-label="我的面板"
                onClick={() => setRailOpen(true)}
              >
                <PanelRight />
              </Button>
            </Tooltip>
          ) : null}

          {account ? (
            <>
              <Tooltip content="通知">
                <Button asChild variant="ghost" size="icon" className="notification-trigger">
                  <Link href="/status/unavailable?from=notifications" aria-label="通知">
                    <Bell />
                  </Link>
                </Button>
              </Tooltip>

              <Button asChild>
                <Link href="/topics/new" aria-label="发帖">
                  <FileText />
                  <span className="publish-label">发帖</span>
                </Link>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="avatar-menu-trigger" type="button" aria-label="账户菜单">
                    <Avatar className="size-full border-0">
                      <AvatarImage src={account.image ?? undefined} alt={account.name} />
                      <AvatarFallback>{account.initials}</AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="account-menu" align="end">
                  <DropdownMenuLabel className="account-summary">
                    <Avatar className="size-11">
                      <AvatarImage src={account.image ?? undefined} alt={account.name} />
                      <AvatarFallback>{account.initials}</AvatarFallback>
                    </Avatar>
                    <span className="account-identity">
                      <span className="account-name-row">
                        <strong>{account.name}</strong>
                        <span>@{account.username}</span>
                      </span>
                      <span className="account-uid-row">
                        <span>UID {account.uid}</span>
                        <Badge variant="trust">TL{account.trustLevel}</Badge>
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
                      <Link href="/account">
                        <Settings /> 账户设置
                      </Link>
                    </DropdownMenuItem>
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
                  <DropdownMenuItem className="text-danger" onSelect={signOut}>
                    <LogOut /> 退出登录
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="anonymous-actions">
              <Button asChild variant="outline" aria-label="登录">
                <Link href="/auth/sign-in">
                  <LogIn /> <span className="auth-action-label">登录</span>
                </Link>
              </Button>
              {registrationOpen ? (
                <Button asChild aria-label="注册">
                  <Link href="/auth/sign-up">
                    <UserPlus /> <span className="auth-action-label">注册</span>
                  </Link>
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {mobileSearchOpen ? (
        <div className="mobile-search-row">
          <form action="/search" role="search" className="mobile-search-field">
            <Search aria-hidden="true" />
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
            />
          </form>
        </div>
      ) : null}
    </header>
  );
}
