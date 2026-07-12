import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form.client";
import { Button } from "@/components/ui/button";

export const metadata = { title: "重置密码" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell title="重置密码" description="设置新密码后，已有会话将全部撤销。">
      {params.token ? (
        <ResetPasswordForm token={params.token} />
      ) : (
        <div className="auth-result">
          <p className="auth-message is-error">重置链接无效或已经过期。</p>
          <Button asChild className="auth-submit">
            <Link href="/auth/forgot-password">重新申请</Link>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
