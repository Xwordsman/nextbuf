import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SetupForm } from "@/components/installation/setup-form.client";
import { getInstallationStatus } from "@/modules/installation/installation.server";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const status = await getInstallationStatus();
  return (
    <AuthShell
      title="首次安装"
      description="使用服务器生成的一次性令牌创建首位管理员。账号密码、邮箱验证和会话继续由 Better Auth 管理。"
    >
      {status.complete ? (
        <p className="auth-message is-success">
          站点已经完成首次安装。<Link href="/auth/sign-in">前往登录</Link>
        </p>
      ) : status.setupAvailable ? (
        <SetupForm />
      ) : (
        <p className="auth-message is-error">
          当前没有可用的 SETUP_TOKEN。请在服务器部署配置中生成至少 32 位随机令牌并重启 Web。
        </p>
      )}
    </AuthShell>
  );
}
