import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell.client";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getPrismaClient } from "@/infrastructure/database/client";
import { getCommunityPermissions } from "@/modules/community/authorization.server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin");
  const permissions = await getCommunityPermissions(getPrismaClient(), session.user.id);
  if (!permissions.active || !permissions.hasModerationRole) notFound();
  return (
    <AdminShell isAdmin={permissions.isAdmin} canModerate={permissions.hasModerationRole}>
      {children}
    </AdminShell>
  );
}
