import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountPageShell } from "@/components/account/account-page-shell";
import { NotificationPreferences } from "@/components/account/notification-preferences.client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/ui/card";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getNotificationPreferences } from "@/modules/notifications/notifications.server";

export const metadata = { title: "通知偏好" };

export default async function NotificationPreferencesPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account/notifications");
  const preferences = await getNotificationPreferences(session.user.id);
  return (
    <AccountPageShell
      active="notifications"
      description="选择各类社区动态的站内和邮件投递方式。"
      title="通知偏好"
    >
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>
            <h2>投递设置</h2>
          </CardTitle>
          <CardDescription>安全邮件不受这些常规通知偏好的影响。</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <NotificationPreferences initial={preferences} />
        </CardContent>
      </Card>
    </AccountPageShell>
  );
}
