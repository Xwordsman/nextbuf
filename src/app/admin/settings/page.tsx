import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminSettings } from "@/components/admin/admin-settings.client";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { requireAdministrator } from "@/modules/admin/authorization.server";
import { AdminError } from "@/modules/admin/errors";
import { getProviderConfigurationStatus } from "@/modules/admin/providers.server";
import { getSiteSettings } from "@/modules/settings/settings.server";
import { getTrustGovernanceOverview } from "@/modules/trust/trust.server";
import { getPrismaClient } from "@/infrastructure/database/client";

export const metadata = { title: "站点设置" };

export default async function AdminSettingsPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin/settings");
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
  return (
    <main className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>站点设置</h1>
          <p>运营规则、Provider 状态和信任规则版本。</p>
        </div>
      </div>
      <AdminSettings
        settings={result.settings}
        providers={getProviderConfigurationStatus()}
        rules={result.trust.rules}
        batches={result.trust.batches}
      />
    </main>
  );
}
