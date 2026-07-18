"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { Badge } from "@/components/admin/ui/badge";
import { Button } from "@/components/admin/ui/button";
import { Checkbox } from "@/components/admin/ui/checkbox";
import { Input } from "@/components/admin/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/ui/table";
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
      <div className="grid gap-3 border-b bg-muted/30 p-4 lg:grid-cols-[auto_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] lg:items-center">
        <p className="text-sm text-muted-foreground">已选择 {selected.length} 个用户</p>
        <Input
          aria-label="批量撤销会话的操作原因"
          onChange={(event) => setReason(event.target.value)}
          placeholder="操作原因"
          value={reason}
        />
        <Input
          aria-label="管理员密码"
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="管理员密码"
          type="password"
          value={password}
        />
        <Button
          disabled={busy || selected.length === 0 || reason.trim().length < 3 || !password}
          onClick={revokeSessions}
          type="button"
          variant="outline"
        >
          {busy ? <KeyRound aria-hidden="true" /> : <LogOut aria-hidden="true" />}
          {busy ? "处理中" : "撤销会话"}
        </Button>
        {message ? (
          <p className="text-sm text-muted-foreground lg:col-span-4" role="status">
            {message}
          </p>
        ) : null}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
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
              <TableCell className="h-28 text-center text-muted-foreground" colSpan={7}>
                没有符合筛选条件的用户。
              </TableCell>
            </TableRow>
          ) : (
            users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <Checkbox
                    aria-label={`选择 ${user.username}`}
                    checked={selected.includes(user.id)}
                    onCheckedChange={(checked) =>
                      setSelected((items) =>
                        checked === true
                          ? [...items, user.id]
                          : items.filter((id) => id !== user.id),
                      )
                    }
                  />
                </TableCell>
                <TableCell className="min-w-56 whitespace-normal">
                  <Link className="font-medium hover:underline" href={`/admin/users/${user.uid}`}>
                    {user.name}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">
                    @{user.username} · UID {user.uid}
                    <br />
                    {user.email}
                    {user.emailVerified ? " · 已验证" : ""}
                  </p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{user.status}</Badge>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <p>{user.communityRoles.map((role) => role.role).join(", ") || "member"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    TL{user.trustState?.currentLevel ?? 0}
                  </p>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <p>{user._count.communityTopics} 主题</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {Math.max(user._count.communityPosts - user._count.communityTopics, 0)} 回复
                  </p>
                </TableCell>
                <TableCell>{user._count.sessions}</TableCell>
                <TableCell>{user.createdAt.toLocaleString("zh-CN")}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </>
  );
}
