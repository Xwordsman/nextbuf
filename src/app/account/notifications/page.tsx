import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/account/account-nav";
import { NotificationPreferences } from "@/components/account/notification-preferences.client";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getNotificationPreferences } from "@/modules/notifications/notifications.server";

export const metadata = { title: "通知偏好" };

export default async function NotificationPreferencesPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account/notifications");
  const preferences = await getNotificationPreferences(session.user.id);
  return (
    <main className="account-page">
      <div className="account-page-head">
        <h1>通知偏好</h1>
        <p>选择各类社区动态的站内和邮件投递方式。</p>
      </div>
      <AccountNav active="notifications" />
      <Panel className="settings-panel">
        <NotificationPreferences initial={preferences} />
      </Panel>
    </main>
  );
}
