import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AdminPage, AdminPageHeader } from "@/components/admin/admin-page-layout";
import { AdminNodeForm } from "@/components/admin/admin-nodes.client";
import { Button } from "@/components/admin/ui/button";
import { Card, CardContent } from "@/components/admin/ui/card";
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
    <AdminPage className="max-w-4xl">
      <AdminPageHeader
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/nodes">
              <ArrowLeft aria-hidden="true" />
              节点列表
            </Link>
          </Button>
        }
        description="节点标识创建后保持稳定；请在公开前确认名称、说明和排序。"
        title="新建节点"
      />
      <Card>
        <CardContent>
          <AdminNodeForm nextSortOrder={nextSortOrder} />
        </CardContent>
      </Card>
    </AdminPage>
  );
}
