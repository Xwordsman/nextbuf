import { AdminSettingsWorkspace } from "@/components/admin/admin-settings-workspace.server";

export const metadata = { title: "Provider 诊断" };

export default function AdminProviderDiagnosticsPage() {
  return <AdminSettingsWorkspace section="providers" />;
}
