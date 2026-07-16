import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form.client";
import { getSiteSettings } from "@/modules/settings/settings.server";
import { runtimeEnv } from "@/shared/config/runtime-env";

export const metadata = { title: "登录" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const settings = await getSiteSettings();
  return (
    <AuthShell title="登录" description="使用已验证的邮箱进入 NextBuf。">
      <SignInForm
        nextPath={params.next ?? "/"}
        registrationOpen={settings.registrationMode !== "closed"}
        githubEnabled={Boolean(runtimeEnv.GITHUB_CLIENT_ID && runtimeEnv.GITHUB_CLIENT_SECRET)}
      />
    </AuthShell>
  );
}
