import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminNodeForm } from "@/components/admin/admin-nodes.client";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getAdminNodes } from "@/modules/admin/content.server";
import { AdminError } from "@/modules/admin/errors";

export const metadata = { title: "新建节点" };

export default async function AdminNewNodePage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin/nodes/new");
  let nodes: Awaited<ReturnType<typeof getAdminNodes>>;
  try {
    nodes = await getAdminNodes(session.user.id);
  } catch (error) {
    if (error instanceof AdminError && error.status === 403) notFound();
    throw error;
  }
  const nextSortOrder = nodes.reduce((maximum, node) => Math.max(maximum, node.sortOrder), 0) + 10;

  return (
    <main className="admin-page">
      <div className="admin-page-head">
        <div>
          <Link href="/admin/nodes">← 节点列表</Link>
          <h1>新建节点</h1>
          <p>节点标识创建后保持稳定；请在公开前确认名称、说明和排序。</p>
        </div>
      </div>
      <Panel className="admin-section-panel admin-node-workspace">
        <AdminNodeForm nextSortOrder={nextSortOrder} />
      </Panel>
    </main>
  );
}
