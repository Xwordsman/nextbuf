"use client";

import { RefreshCw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function WorkerActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const testEmail = async () => {
    setBusy("email");
    const response = await fetch("/api/admin/worker/test-email", { method: "POST" });
    setMessage(response.ok ? "测试邮件已进入 Outbox。" : "测试邮件入队失败。");
    setBusy(null);
    if (response.ok) router.refresh();
  };

  return (
    <div className="worker-action-bar">
      <Button type="button" variant="outline" onClick={testEmail} disabled={busy !== null}>
        <Send /> 发送测试邮件
      </Button>
      <span role="status">{message}</span>
    </div>
  );
}

export function WorkerReplayButton({ failureId }: { failureId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const replay = async () => {
    setBusy(true);
    const response = await fetch(`/api/admin/worker/failures/${failureId}/replay`, {
      method: "POST",
    });
    setBusy(false);
    if (response.ok) router.refresh();
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={replay} disabled={busy}>
      <RefreshCw /> {busy ? "登记中" : "重放"}
    </Button>
  );
}
