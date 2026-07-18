import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountPageShell } from "@/components/account/account-page-shell";
import { ProfileSettings } from "@/components/account/profile-settings.client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/ui/card";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getAccountProfile } from "@/modules/profiles/profile.server";
import { usernameCooldownEnds } from "@/modules/profiles/username-policy";

export const metadata = { title: "账号中心" };

export default async function AccountPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/account");
  const user = await getAccountProfile(session.user.id);
  const availableAt = user.usernameChangedAt ? usernameCooldownEnds(user.usernameChangedAt) : null;

  return (
    <AccountPageShell
      active="profile"
      description="管理公开身份、头像、隐私和账号状态。"
      title="账号中心"
    >
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle>
            <h2>资料与公开身份</h2>
          </CardTitle>
          <CardDescription>资料保存后会立即用于你的公开个人主页。</CardDescription>
        </CardHeader>
        <CardContent className="px-5 py-0 sm:px-6">
          <ProfileSettings
            profile={{
              name: user.name,
              username: user.username,
              uid: user.uid,
              image: user.image,
              initials: user.name.trim().slice(0, 1).toLocaleUpperCase("zh-CN") || "U",
              bio: user.profile?.bio ?? "",
              website: user.profile?.website ?? "",
              isPublic: user.profile?.isPublic ?? true,
              showActivity: user.profile?.showActivity ?? true,
              usernameAvailableAt:
                availableAt && availableAt > new Date() ? availableAt.toISOString() : null,
              deletionScheduledAt: user.deletionScheduledAt?.toISOString() ?? null,
            }}
          />
        </CardContent>
      </Card>
    </AccountPageShell>
  );
}
