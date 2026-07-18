import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { AdminPage, AdminPageHeader } from "@/components/admin/admin-page-layout";
import { AdminNodesList } from "@/components/admin/admin-nodes-list";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardContent } from "@/components/shadcn/ui/card";
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
    <AdminPage>
      <AdminPageHeader
        actions={
          <Button asChild>
            <Link href="/admin/nodes/new">
              <Plus aria-hidden="true" />
              新建节点
            </Link>
          </Button>
        }
        description="查看节点状态、主题数量与版主配置；新建和编辑在独立工作区完成。"
        title="节点管理"
      />
      <Card>
        <CardContent className="px-0 py-0">
          <AdminNodesList nodes={nodes} />
        </CardContent>
      </Card>
    </AdminPage>
  );
}
