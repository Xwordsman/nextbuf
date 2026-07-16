"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUDIT_EXPORT_CONFIRMATION } from "@/shared/admin-contracts";

type Filters = { source?: string; action?: string; actorUid?: number; from?: string; to?: string };

export function AdminAuditExport({ filters }: { filters: Filters }) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const exportAudit = async () => {
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
    const response = await fetch("/api/admin/audit/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: AUDIT_EXPORT_CONFIRMATION, reason, filters }),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { code?: string } | null;
      setMessage(`导出失败：${result?.code ?? response.status}`);
      setBusy(false);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nextbuf-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage(`已导出 ${response.headers.get("x-nextbuf-export-count") ?? "0"} 条记录。`);
    setPassword("");
    setBusy(false);
  };
  return (
    <div className="admin-export-bar">
      <Input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="导出原因"
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
        disabled={busy || !password || reason.trim().length < 3}
        onClick={exportAudit}
      >
        {busy ? "导出中" : "导出当前筛选"}
      </Button>
      <span role="status">{message}</span>
    </div>
  );
}
