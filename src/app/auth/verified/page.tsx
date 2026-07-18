import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/shadcn/ui/button";

export const metadata = { title: "邮箱已验证" };

export default function VerifiedPage() {
  return (
    <AuthShell title="邮箱已验证" description="账号现在可以用于登录。">
      <div className="grid justify-items-center gap-5 text-center">
        <span
          className="flex size-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"
          aria-hidden="true"
        >
          <BadgeCheck className="size-6" />
        </span>
        <Button asChild className="w-full" size="lg">
          <Link href="/auth/sign-in">前往登录</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
