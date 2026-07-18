import { AdminSettingsWorkspace } from "@/components/admin/admin-settings-workspace.server";

export const metadata = { title: "信任规则" };

export default function AdminTrustRulesPage() {
  return <AdminSettingsWorkspace section="trust" />;
}
