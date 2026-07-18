"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ShieldCheck, UserRoundCog } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/shadcn/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/shadcn/ui/alert-dialog";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import { Input } from "@/components/shadcn/ui/input";
import { Label } from "@/components/shadcn/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select";
import {
  BULK_SESSION_CONFIRMATION,
  ROLE_CHANGE_CONFIRMATION,
  TRUST_CHANGE_CONFIRMATION,
} from "@/shared/admin-contracts";

type Role = {
  id: string;
  role: string;
  nodeId: string | null;
  scopeKey: string;
  node: { name: string; slug: string } | null;
};
type NodeOption = { id: string; name: string; slug: string };

export function AdminUserActions({
  userId,
  roles,
  nodes,
  manualTrustLevel,
}: {
  userId: string;
  roles: Role[];
  nodes: NodeOption[];
  manualTrustLevel: number | null;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [role, setRole] = useState("global_moderator");
  const [nodeId, setNodeId] = useState(nodes[0]?.id ?? "");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const reauthenticate = async () => {
    const response = await fetch("/api/admin/reauthenticate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    return response.ok;
  };

  const run = async (name: string, action: () => Promise<Response>) => {
    if (!password || reason.trim().length < 3) return;
    setBusy(name);
    setMessage("");
    if (!(await reauthenticate())) {
      setMessage("二次验证失败。");
      setBusy("");
      return;
    }
    const response = await action();
    const result = (await response.json().catch(() => null)) as { code?: string } | null;
    setMessage(response.ok ? "操作已完成。" : `操作失败：${result?.code ?? response.status}`);
    setBusy("");
    if (response.ok) {
      setPassword("");
      router.refresh();
    }
  };

  const grantRole = () =>
    run("grant", () =>
      fetch("/api/admin/governance/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId,
          role,
          ...(role === "node_moderator" ? { nodeId } : {}),
          reason,
          confirmation: ROLE_CHANGE_CONFIRMATION,
        }),
      }),
    );

  const revokeRole = (assignmentId: string) =>
    run(`role:${assignmentId}`, () =>
      fetch("/api/admin/governance/roles", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignmentId, reason, confirmation: ROLE_CHANGE_CONFIRMATION }),
      }),
    );

  const updateTrust = (level: 4 | null) =>
    run("trust", () =>
      fetch(`/api/admin/governance/trust/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level, reason, confirmation: TRUST_CHANGE_CONFIRMATION }),
      }),
    );

  const revokeSessions = () =>
    run("sessions", () =>
      fetch("/api/admin/users/bulk-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userIds: [userId],
          reason,
          confirmation: BULK_SESSION_CONFIRMATION,
        }),
      }),
    );

  const canSubmit = Boolean(password) && reason.trim().length >= 3 && !busy;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="admin-reason">操作原因</Label>
          <Input
            id="admin-reason"
            onChange={(event) => setReason(event.target.value)}
            placeholder="至少 3 个字符"
            value={reason}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="admin-password">管理员密码</Label>
          <Input
            autoComplete="current-password"
            id="admin-password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </div>
      </div>

      <div className="space-y-4 border-t pt-6">
        <div className="flex items-center gap-2">
          <UserRoundCog aria-hidden="true" className="size-4" />
          <h3 className="text-sm font-medium">角色</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(11rem,1fr)_minmax(11rem,1fr)_auto]">
          <Label className="sr-only" htmlFor="admin-role">
            治理角色
          </Label>
          <Select onValueChange={setRole} value={role}>
            <SelectTrigger className="w-full" id="admin-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global_moderator">全局版主</SelectItem>
              <SelectItem value="node_moderator">节点版主</SelectItem>
              <SelectItem value="admin">管理员</SelectItem>
            </SelectContent>
          </Select>
          {role === "node_moderator" ? (
            <div>
              <Label className="sr-only" htmlFor="admin-role-node">
                管理节点
              </Label>
              <Select onValueChange={setNodeId} value={nodeId}>
                <SelectTrigger className="w-full" id="admin-role-node">
                  <SelectValue placeholder="选择节点" />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="hidden md:block" />
          )}
          <Button disabled={!canSubmit} onClick={grantRole} type="button">
            {busy === "grant" ? "处理中" : "授予角色"}
          </Button>
        </div>
        <div className="divide-y rounded-lg border">
          {roles.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">当前没有治理角色。</p>
          ) : (
            roles.map((assignment) => (
              <div
                className="flex items-center justify-between gap-3 px-4 py-3"
                key={assignment.id}
              >
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline">{assignment.role}</Badge>
                  {assignment.node ? <span>{assignment.node.name}</span> : null}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button disabled={!canSubmit} size="sm" type="button" variant="destructive">
                      撤销
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>撤销治理角色？</AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作会立即移除该用户的 {assignment.role} 权限，并写入治理审计。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={!canSubmit}
                        onClick={() => revokeRole(assignment.id)}
                        variant="destructive"
                      >
                        确认撤销
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="space-y-4 border-t pt-6">
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="size-4" />
          <h3 className="text-sm font-medium">信任与会话</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!canSubmit}
            onClick={() => updateTrust(manualTrustLevel === 4 ? null : 4)}
            type="button"
            variant="outline"
          >
            {manualTrustLevel === 4 ? "撤销人工 TL4" : "授予人工 TL4"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={!canSubmit} type="button" variant="destructive">
                撤销全部会话
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertTriangle aria-hidden="true" className="size-5 text-destructive" />
                <AlertDialogTitle>撤销该用户的全部会话？</AlertDialogTitle>
                <AlertDialogDescription>
                  用户将需要重新登录。该操作不会删除内容、角色或账号资料。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  disabled={!canSubmit}
                  onClick={revokeSessions}
                  variant="destructive"
                >
                  确认撤销
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {message ? (
        <Alert>
          <AlertTitle>操作结果</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
