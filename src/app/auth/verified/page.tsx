import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

export const metadata = { title: "邮箱已验证" };

export default function VerifiedPage() {
  return (
    <AuthShell title="邮箱已验证" description="账号现在可以用于登录。">
      <div className="auth-result">
        <BadgeCheck className="auth-result-icon" aria-hidden="true" />
        <Button asChild className="auth-submit">
          <Link href="/auth/sign-in">前往登录</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
