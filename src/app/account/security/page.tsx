import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SessionManager } from "@/components/auth/session-manager.client";
import { Panel } from "@/components/ui/panel";
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
    <main className="account-page">
      <div className="account-page-head">
        <h1>账号安全</h1>
        <p>查看当前登录设备并撤销不再使用的会话。</p>
      </div>
      <Panel className="security-panel">
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
      </Panel>
    </main>
  );
}
