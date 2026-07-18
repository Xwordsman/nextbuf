import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Filter, Search } from "lucide-react";
import { AdminPage, AdminPageHeader, AdminPagination } from "@/components/admin/admin-page-layout";
import { AdminUsersTable } from "@/components/admin/admin-users-table.client";
import { Button } from "@/components/admin/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/ui/card";
import { Input } from "@/components/admin/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/admin/ui/select";
import { getAuth } from "@/infrastructure/auth/better-auth";
import { AdminError } from "@/modules/admin/errors";
import { listAdminUsers } from "@/modules/admin/users.server";

export const metadata = { title: "用户管理" };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; before?: string }>;
}) {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in?next=/admin/users");
  const params = await searchParams;
  const beforeUid =
    params.before && /^\d+$/.test(params.before) ? Number(params.before) : undefined;
  let result: Awaited<ReturnType<typeof listAdminUsers>>;
  try {
    result = await listAdminUsers(session.user.id, {
      query: params.q,
      status: params.status,
      beforeUid,
    });
  } catch (error) {
    if (error instanceof AdminError && error.status === 403) notFound();
    throw error;
  }
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status) query.set("status", params.status);
  const nextHref = result.nextBeforeUid
    ? `/admin/users?${query.toString()}${query.size ? "&" : ""}before=${result.nextBeforeUid}`
    : undefined;

  return (
    <AdminPage>
      <AdminPageHeader description="账号、角色、会话、制裁和信任状态。" title="用户管理" />

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter aria-hidden="true" className="size-4" />
            筛选用户
          </CardTitle>
          <CardDescription>支持 UID、用户名、昵称和邮箱检索。</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action="/admin/users"
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto]"
          >
            <Input
              aria-label="搜索用户"
              defaultValue={params.q ?? ""}
              name="q"
              placeholder="UID、用户名、昵称或邮箱"
            />
            <Select defaultValue={params.status ?? "all"} name="status">
              <SelectTrigger aria-label="用户状态" className="w-full">
                <SelectValue placeholder="全部状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="pending">pending</SelectItem>
                <SelectItem value="active">active</SelectItem>
                <SelectItem value="restricted">restricted</SelectItem>
                <SelectItem value="suspended">suspended</SelectItem>
                <SelectItem value="deleted">deleted</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit">
              <Search aria-hidden="true" />
              筛选
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>用户列表</CardTitle>
          <CardDescription>批量撤销会话需要当前管理员重新验证密码。</CardDescription>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <AdminUsersTable users={result.items} />
        </CardContent>
      </Card>

      <AdminPagination nextHref={nextHref} />
    </AdminPage>
  );
}
