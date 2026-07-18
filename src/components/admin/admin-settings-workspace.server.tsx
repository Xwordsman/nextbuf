import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminPage, AdminPageHeader } from "@/components/admin/admin-page-layout";
import { AdminSettings, type AdminSettingsSection } from "@/components/admin/admin-settings.client";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getPrismaClient } from "@/infrastructure/database/client";
import { requireAdministrator } from "@/modules/admin/authorization.server";
import { AdminError } from "@/modules/admin/errors";
import { getProviderConfigurationStatus } from "@/modules/admin/providers.server";
import { getSiteSettings } from "@/modules/settings/settings.server";
import { getTrustGovernanceOverview } from "@/modules/trust/trust.server";

const sectionCopy: Record<AdminSettingsSection, { title: string; description: string }> = {
  general: {
    title: "站点设置",
    description: "注册策略、内容开关和全站频率限制。",
  },
  providers: {
    title: "Provider 诊断",
    description: "查看脱敏配置状态并验证邮件、存储和 GitHub OAuth 连接。",
  },
  trust: {
    title: "信任规则",
    description: "创建规则草稿、运行预览，并在二次验证后激活。",
  },
};

export async function AdminSettingsWorkspace({ section }: { section: AdminSettingsSection }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const nextPath =
    section === "general" ? "/admin/settings" : `/admin/settings/${encodeURIComponent(section)}`;
  if (!session) redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`);
  let result: {
    settings: Awaited<ReturnType<typeof getSiteSettings>>;
    trust: Awaited<ReturnType<typeof getTrustGovernanceOverview>>;
  };
  try {
    await getPrismaClient().$transaction((transaction) =>
      requireAdministrator(transaction, session.user.id),
    );
    const [settings, trust] = await Promise.all([
      getSiteSettings(),
      getTrustGovernanceOverview(session.user.id),
    ]);
    result = { settings, trust };
  } catch (error) {
    if (error instanceof AdminError && error.status === 403) notFound();
    throw error;
  }
  const copy = sectionCopy[section];
  return (
    <AdminPage>
      <AdminPageHeader description={copy.description} title={copy.title} />
      <AdminSettings
        section={section}
        settings={result.settings}
        providers={getProviderConfigurationStatus()}
        rules={result.trust.rules}
        batches={result.trust.batches}
      />
    </AdminPage>
  );
}
