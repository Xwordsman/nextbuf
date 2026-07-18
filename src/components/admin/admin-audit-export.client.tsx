"use client";

import { useState } from "react";
import { Download, KeyRound } from "lucide-react";
import { Button } from "@/components/shadcn/ui/button";
import { Input } from "@/components/shadcn/ui/input";
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
    <div className="grid gap-3 border-b bg-muted/30 p-4 lg:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto] lg:items-center">
      <Input
        aria-label="导出原因"
        onChange={(event) => setReason(event.target.value)}
        placeholder="导出原因"
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
        disabled={busy || !password || reason.trim().length < 3}
        onClick={exportAudit}
        type="button"
        variant="outline"
      >
        {busy ? <KeyRound aria-hidden="true" /> : <Download aria-hidden="true" />}
        {busy ? "导出中" : "导出当前筛选"}
      </Button>
      {message ? (
        <p className="text-sm text-muted-foreground lg:col-span-3" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
