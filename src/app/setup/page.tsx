import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SetupForm } from "@/components/installation/setup-form.client";
import { Alert, AlertDescription } from "@/components/shadcn/ui/alert";
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
        <Alert role="status" className="border-emerald-200 bg-emerald-50 text-emerald-950">
          <AlertDescription className="text-emerald-800">
            站点已经完成首次安装。{" "}
            <Link
              className="font-medium underline underline-offset-4 hover:text-emerald-950"
              href="/auth/sign-in?next=/admin/nodes"
            >
              登录并创建节点
            </Link>
          </AlertDescription>
        </Alert>
      ) : status.setupAvailable ? (
        <SetupForm />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>
            当前没有可用的 SETUP_TOKEN。请在服务器部署配置中生成至少 32 位随机令牌并重启 Web。
          </AlertDescription>
        </Alert>
      )}
    </AuthShell>
  );
}
