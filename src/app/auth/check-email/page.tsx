import { AuthShell } from "@/components/auth/auth-shell";
import { ResendVerificationForm } from "@/components/auth/resend-verification-form.client";

export const metadata = { title: "验证邮箱" };

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthShell title="检查邮箱" description="验证链接仅用于确认邮箱所有权。">
      <ResendVerificationForm initiallySent={params.sent === "1"} />
    </AuthShell>
  );
}
