import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountNav } from "@/components/account/account-nav";
import { ProfileSettings } from "@/components/account/profile-settings.client";
import { Panel } from "@/components/ui/panel";
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
    <main className="account-page">
      <div className="account-page-head">
        <h1>账号中心</h1>
        <p>管理公开身份、头像、隐私和账号状态。</p>
      </div>
      <AccountNav active="profile" />
      <Panel className="settings-panel">
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
      </Panel>
    </main>
  );
}
