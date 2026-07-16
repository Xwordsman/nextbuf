import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AdminNodes } from "@/components/admin/admin-nodes.client";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getAdminNodes } from "@/modules/admin/content.server";
import { AdminError } from "@/modules/admin/errors";

export const metadata = { title: "节点管理" };

export default async function AdminNodesPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin/nodes");
  let nodes: Awaited<ReturnType<typeof getAdminNodes>>;
  try {
    nodes = await getAdminNodes(session.user.id);
  } catch (error) {
    if (error instanceof AdminError && error.status === 403) notFound();
    throw error;
  }
  return (
    <main className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>节点</h1>
          <p>名称、说明、排序、可见性和归档状态。</p>
        </div>
      </div>
      <Panel className="admin-section-panel">
        <AdminNodes nodes={nodes} />
      </Panel>
    </main>
  );
}
