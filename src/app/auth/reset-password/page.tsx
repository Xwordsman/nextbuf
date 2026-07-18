import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form.client";
import { Alert, AlertDescription } from "@/components/shadcn/ui/alert";
import { Button } from "@/components/shadcn/ui/button";

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
        <div className="grid gap-4">
          <Alert variant="destructive">
            <AlertDescription>重置链接无效或已经过期。</AlertDescription>
          </Alert>
          <Button asChild className="w-full" size="lg">
            <Link href="/auth/forgot-password">重新申请</Link>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
