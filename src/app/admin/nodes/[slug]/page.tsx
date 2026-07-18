import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminNodeForm } from "@/components/admin/admin-nodes.client";
import { Panel } from "@/components/ui/panel";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { getAdminNodes } from "@/modules/admin/content.server";
import { AdminError } from "@/modules/admin/errors";

export const metadata = { title: "编辑节点" };

export default async function AdminNodePage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  const { slug } = await params;
  if (!session) redirect(`/auth/sign-in?next=/admin/nodes/${encodeURIComponent(slug)}`);
  let nodes: Awaited<ReturnType<typeof getAdminNodes>>;
  try {
    nodes = await getAdminNodes(session.user.id);
  } catch (error) {
    if (error instanceof AdminError && error.status === 403) notFound();
    throw error;
  }
  const node = nodes.find((item) => item.slug === slug);
  if (!node) notFound();

  return (
    <main className="admin-page">
      <div className="admin-page-head">
        <div>
          <Link href="/admin/nodes">← 节点列表</Link>
          <h1>编辑节点</h1>
          <p>修改展示与运营属性；归档不会删除节点主题或历史审计记录。</p>
        </div>
      </div>
      <Panel className="admin-section-panel admin-node-workspace">
        <AdminNodeForm node={node} nextSortOrder={node.sortOrder} />
      </Panel>
    </main>
  );
}
