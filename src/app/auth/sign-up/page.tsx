import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form.client";
import { runtimeEnv } from "@/shared/config/runtime-env";

export const metadata = { title: "创建账号" };

export default function SignUpPage() {
  if (runtimeEnv.AUTH_REGISTRATION_MODE === "closed")
    redirect("/status/unavailable?from=registration");

  return (
    <AuthShell title="创建账号" description="注册后需要先完成邮箱验证。">
      <SignUpForm
        inviteRequired={runtimeEnv.AUTH_REGISTRATION_MODE === "invite"}
        githubEnabled={Boolean(
          runtimeEnv.AUTH_REGISTRATION_MODE === "open" &&
          runtimeEnv.GITHUB_CLIENT_ID &&
          runtimeEnv.GITHUB_CLIENT_SECRET,
        )}
      />
    </AuthShell>
  );
}
