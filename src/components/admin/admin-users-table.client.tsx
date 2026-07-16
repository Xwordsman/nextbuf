"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BULK_SESSION_CONFIRMATION } from "@/shared/admin-contracts";

type UserRow = {
  id: string;
  uid: number;
  username: string;
  name: string;
  email: string;
  emailVerified: boolean;
  status: string;
  createdAt: Date;
  trustState: { currentLevel: number } | null;
  communityRoles: { role: string; scopeKey: string }[];
  _count: { communityTopics: number; communityPosts: number; sessions: number };
};

export function AdminUsersTable({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const revokeSessions = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    setMessage("");
    const reauth = await fetch("/api/admin/reauthenticate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!reauth.ok) {
      setMessage("二次验证失败。");
      setBusy(false);
      return;
    }
    const response = await fetch("/api/admin/users/bulk-sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userIds: selected,
        reason,
        confirmation: BULK_SESSION_CONFIRMATION,
      }),
    });
    const result = (await response.json().catch(() => null)) as {
      revokedSessions?: number;
      code?: string;
    } | null;
    setMessage(
      response.ok
        ? `已撤销 ${result?.revokedSessions ?? 0} 个会话。`
        : `操作失败：${result?.code ?? response.status}`,
    );
    setBusy(false);
    if (response.ok) {
      setSelected([]);
      setPassword("");
      router.refresh();
    }
  };

  return (
    <>
      <div className="admin-bulk-bar">
        <span>已选择 {selected.length} 个用户</span>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="操作原因"
        />
        <Input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="管理员密码"
          autoComplete="current-password"
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy || selected.length === 0 || reason.trim().length < 3 || !password}
          onClick={revokeSessions}
        >
          {busy ? "处理中" : "批量撤销会话"}
        </Button>
        <span role="status">{message}</span>
      </div>
      <div className="admin-table-scroll">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <span className="sr-only">选择</span>
              </TableHead>
              <TableHead>用户</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>角色 / TL</TableHead>
              <TableHead>内容</TableHead>
              <TableHead>会话</TableHead>
              <TableHead>注册时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>没有符合筛选条件的用户。</TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${user.username}`}
                      checked={selected.includes(user.id)}
                      onChange={(event) =>
                        setSelected((items) =>
                          event.target.checked
                            ? [...items, user.id]
                            : items.filter((id) => id !== user.id),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Link className="admin-table-primary" href={`/admin/users/${user.uid}`}>
                      {user.name}
                    </Link>
                    <small>
                      @{user.username} · UID {user.uid}
                      <br />
                      {user.email}
                      {user.emailVerified ? " · 已验证" : ""}
                    </small>
                  </TableCell>
                  <TableCell>{user.status}</TableCell>
                  <TableCell>
                    {user.communityRoles.map((role) => role.role).join(", ") || "member"}
                    <small>TL{user.trustState?.currentLevel ?? 0}</small>
                  </TableCell>
                  <TableCell>
                    {user._count.communityTopics} 主题
                    <small>
                      {Math.max(user._count.communityPosts - user._count.communityTopics, 0)} 回复
                    </small>
                  </TableCell>
                  <TableCell>{user._count.sessions}</TableCell>
                  <TableCell>{user.createdAt.toLocaleString("zh-CN")}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
