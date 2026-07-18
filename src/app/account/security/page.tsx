import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SessionManager } from "@/components/auth/session-manager.client";
import { AccountPageShell } from "@/components/account/account-page-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/ui/card";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getPrismaClient } from "@/infrastructure/database/client";

export const metadata = { title: "账号安全" };
export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const requestHeaders = await headers();
  const current = await getAuth().api.getSession({ headers: requestHeaders });
  if (!current) redirect("/auth/sign-in?next=/account/security");

  const sessions = await getPrismaClient().session.findMany({
    where: { userId: current.user.id, expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <AccountPageShell
      active="security"
      description="查看当前登录设备并撤销不再使用的会话。"
      title="账号安全"
    >
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>
            <h2>登录会话</h2>
          </CardTitle>
          <CardDescription>撤销会话后，该设备需要重新登录。</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <SessionManager
            initialSessions={sessions.map((session) => ({
              token: session.token,
              createdAt: session.createdAt.toISOString(),
              expiresAt: session.expiresAt.toISOString(),
              ipAddress: session.ipAddress,
              userAgent: session.userAgent,
              current: session.token === current.session.token,
            }))}
          />
        </CardContent>
      </Card>
    </AccountPageShell>
  );
}
