import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminUsersTable } from "@/components/admin/admin-users-table.client";
import { Panel } from "@/components/ui/panel";
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
  return (
    <main className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1>用户</h1>
          <p>账号、角色、会话、制裁和信任状态。</p>
        </div>
      </div>
      <Panel className="admin-filter-panel">
        <form action="/admin/users">
          <input name="q" defaultValue={params.q ?? ""} placeholder="UID、用户名、昵称或邮箱" />
          <select name="status" defaultValue={params.status ?? "all"}>
            <option value="all">全部状态</option>
            <option value="pending">pending</option>
            <option value="active">active</option>
            <option value="restricted">restricted</option>
            <option value="suspended">suspended</option>
            <option value="deleted">deleted</option>
          </select>
          <button type="submit">筛选</button>
        </form>
      </Panel>
      <Panel className="admin-section-panel admin-table-panel">
        <AdminUsersTable users={result.items} />
      </Panel>
      {result.nextBeforeUid ? (
        <div className="admin-pagination">
          <Link
            href={`/admin/users?${query.toString()}${query.size ? "&" : ""}before=${result.nextBeforeUid}`}
          >
            下一页
          </Link>
        </div>
      ) : null}
    </main>
  );
}
