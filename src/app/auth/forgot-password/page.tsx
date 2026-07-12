import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form.client";

export const metadata = { title: "找回密码" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="找回密码" description="无论邮箱是否存在，页面都会返回相同结果。">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
