"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="admin-user-actions">
      <div className="admin-action-credentials">
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
      </div>
      <div className="admin-action-group">
        <h3>角色</h3>
        <div className="admin-inline-form">
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="global_moderator">全局版主</option>
            <option value="node_moderator">节点版主</option>
            <option value="admin">管理员</option>
          </select>
          {role === "node_moderator" ? (
            <select value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
              {nodes.map((node) => (
                <option value={node.id} key={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          ) : null}
          <Button type="button" disabled={Boolean(busy)} onClick={grantRole}>
            {busy === "grant" ? "处理中" : "授予角色"}
          </Button>
        </div>
        <div className="admin-role-list">
          {roles.length === 0 ? (
            <span>当前没有治理角色。</span>
          ) : (
            roles.map((assignment) => (
              <div key={assignment.id}>
                <span>
                  {assignment.role}
                  {assignment.node ? ` · ${assignment.node.name}` : ""}
                </span>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() => revokeRole(assignment.id)}
                >
                  撤销
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="admin-action-group">
        <h3>信任与会话</h3>
        <div className="admin-panel-actions">
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(busy)}
            onClick={() => updateTrust(manualTrustLevel === 4 ? null : 4)}
          >
            {manualTrustLevel === 4 ? "撤销人工 TL4" : "授予人工 TL4"}
          </Button>
          <Button type="button" variant="danger" disabled={Boolean(busy)} onClick={revokeSessions}>
            撤销全部会话
          </Button>
        </div>
      </div>
      <p className="admin-action-message" role="status">
        {message}
      </p>
    </div>
  );
}
