import { AdminSettingsWorkspace } from "@/components/admin/admin-settings-workspace.server";

export const metadata = { title: "站点设置" };

export default function AdminSettingsPage() {
  return <AdminSettingsWorkspace section="general" />;
}
