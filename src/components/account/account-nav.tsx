import Link from "next/link";
import {
  Bell,
  Bookmark,
  FileText,
  Gauge,
  History,
  Rss,
  ShieldCheck,
  UserRound,
} from "lucide-react";

export function AccountNav({
  active,
}: {
  active:
    | "profile"
    | "security"
    | "trust"
    | "notifications"
    | "topics"
    | "bookmarks"
    | "following"
    | "activity";
}) {
  return (
    <nav className="account-nav" aria-label="账号中心">
      <Link href="/account" aria-current={active === "profile" ? "page" : undefined}>
        <UserRound /> 资料与偏好
      </Link>
      <Link href="/account/security" aria-current={active === "security" ? "page" : undefined}>
        <ShieldCheck /> 账号安全
      </Link>
      <Link href="/account/trust" aria-current={active === "trust" ? "page" : undefined}>
        <Gauge /> 信任等级
      </Link>
      <Link
        href="/account/notifications"
        aria-current={active === "notifications" ? "page" : undefined}
      >
        <Bell /> 通知偏好
      </Link>
      <Link href="/account/topics" aria-current={active === "topics" ? "page" : undefined}>
        <FileText /> 我的主题
      </Link>
      <Link href="/account/bookmarks" aria-current={active === "bookmarks" ? "page" : undefined}>
        <Bookmark /> 我的收藏
      </Link>
      <Link href="/account/following" aria-current={active === "following" ? "page" : undefined}>
        <Rss /> 我的关注
      </Link>
      <Link href="/account/activity" aria-current={active === "activity" ? "page" : undefined}>
        <History /> 我的参与
      </Link>
    </nav>
  );
}
