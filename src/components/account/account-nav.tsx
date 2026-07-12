import Link from "next/link";
import { FileText, ShieldCheck, UserRound } from "lucide-react";

export function AccountNav({ active }: { active: "profile" | "security" | "topics" }) {
  return (
    <nav className="account-nav" aria-label="账号中心">
      <Link href="/account" aria-current={active === "profile" ? "page" : undefined}>
        <UserRound /> 资料与偏好
      </Link>
      <Link href="/account/security" aria-current={active === "security" ? "page" : undefined}>
        <ShieldCheck /> 账号安全
      </Link>
      <Link href="/account/topics" aria-current={active === "topics" ? "page" : undefined}>
        <FileText /> 我的主题
      </Link>
    </nav>
  );
}
