"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Bookmark,
  FileText,
  LogOut,
  MessageSquare,
  PanelRight,
  Plus,
  Search,
  Settings,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  CommunityNodeView,
  CommunityNotificationView,
  CommunityUserView,
} from "@/modules/community/contracts/home-view";
import { useCommunityUi } from "@/components/community/community-ui-provider.client";
import { PublishTopicDialog } from "@/components/community/publish-topic-dialog.client";
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
  currentUser: CommunityUserView;
  notifications: CommunityNotificationView[];
  nodes: CommunityNodeView[];
};

export function SiteHeader({ currentUser, notifications, nodes }: SiteHeaderProps) {
  const pathname = usePathname();
  const { query, setQuery, mobileSearchOpen, setMobileSearchOpen, setRailOpen } = useCommunityUi();
  const [publishOpen, setPublishOpen] = useState(false);
  const [readNotifications, setReadNotifications] = useState<Set<number>>(() => new Set());
  const unreadCount = useMemo(
    () => notifications.filter((item) => item.unread && !readNotifications.has(item.id)).length,
    [notifications, readNotifications],
  );

  const markAllRead = () => setReadNotifications(new Set(notifications.map((item) => item.id)));

  return (
    <>
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

          <label className="header-search" htmlFor="desktop-search">
            <Search aria-hidden="true" />
            <span className="sr-only">搜索话题、节点或作者</span>
            <Input
              id="desktop-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索话题、节点或作者..."
              autoComplete="off"
            />
          </label>

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

            {pathname === "/" ? (
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

            <DropdownMenu>
              <Tooltip content="通知">
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={unreadCount > 0 ? `通知，${unreadCount} 条未读` : "通知"}
                    className="notification-trigger"
                  >
                    <Bell />
                    {unreadCount > 0 ? (
                      <span className="notification-dot" aria-hidden="true" />
                    ) : null}
                  </Button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent className="notification-menu" align="end">
                <div className="notification-head">
                  <strong>通知</strong>
                  <Button type="button" variant="outline" size="sm" onClick={markAllRead}>
                    全部已读
                  </Button>
                </div>
                <div className="notification-list">
                  {notifications.map((notification) => {
                    const unread = notification.unread && !readNotifications.has(notification.id);
                    return (
                      <DropdownMenuItem
                        key={notification.id}
                        className="notification-item"
                        onSelect={() =>
                          setReadNotifications((current) => new Set(current).add(notification.id))
                        }
                      >
                        <Avatar className="size-9">
                          <AvatarImage
                            src={notification.actorAvatarUrl}
                            alt={notification.actorName}
                          />
                          <AvatarFallback>{notification.actorInitials}</AvatarFallback>
                        </Avatar>
                        <span className="notification-copy">
                          <span className="notification-title">
                            <strong>{notification.actorName}</strong> {notification.title}
                          </span>
                          <span>{notification.description}</span>
                          <small>{notification.timeLabel}</small>
                        </span>
                        {unread ? <span className="notification-unread" aria-label="未读" /> : null}
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button type="button" aria-label="发帖" onClick={() => setPublishOpen(true)}>
              <Plus />
              <span className="publish-label">发帖</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="avatar-menu-trigger" type="button" aria-label="账户菜单">
                  <Avatar className="size-full border-0">
                    <AvatarImage src={currentUser.avatarUrl} alt={currentUser.name} />
                    <AvatarFallback>{currentUser.initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="account-menu" align="end">
                <DropdownMenuLabel className="account-summary">
                  <Avatar className="size-11">
                    <AvatarImage src={currentUser.avatarUrl} alt={currentUser.name} />
                    <AvatarFallback>{currentUser.initials}</AvatarFallback>
                  </Avatar>
                  <span className="account-identity">
                    <span className="account-name-row">
                      <strong>{currentUser.name}</strong>
                      <span>@{currentUser.username}</span>
                    </span>
                    <span className="account-uid-row">
                      <span>UID {currentUser.uid}</span>
                      <Badge variant="trust">TL{currentUser.trustLevel}</Badge>
                    </span>
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link href="/status/unavailable?from=profile">
                      <UserRound /> 个人主页
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/status/unavailable?from=settings">
                      <Settings /> 账户设置
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/status/unavailable?from=topics">
                      <FileText /> 我的话题
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/status/unavailable?from=bookmarks">
                      <Bookmark /> 我的收藏
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled className="text-danger">
                  <LogOut /> 退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {mobileSearchOpen ? (
          <div className="mobile-search-row">
            <label htmlFor="mobile-search" className="mobile-search-field">
              <Search aria-hidden="true" />
              <span className="sr-only">搜索话题、节点或作者</span>
              <Input
                id="mobile-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索话题、节点或作者..."
                autoFocus
              />
            </label>
          </div>
        ) : null}
      </header>

      <PublishTopicDialog open={publishOpen} onOpenChange={setPublishOpen} nodes={nodes} />
    </>
  );
}
