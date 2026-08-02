"use client";

import { RefreshCw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { Button } from "@/components/shadcn/ui/button";

export function WorkerActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const testEmail = async () => {
    setBusy("email");
    setMessage("");
    try {
      const response = await fetch("/api/admin/worker/test-email", { method: "POST" });
      const result = (await response.json().catch(() => null)) as { code?: string } | null;
      setMessage(
        response.ok
          ? "测试邮件已进入 Outbox。"
          : `测试邮件入队失败：${result?.code ?? response.status}`,
      );
      if (response.ok) router.refresh();
    } catch {
      setMessage("测试邮件入队失败：网络请求未完成。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={testEmail} disabled={busy !== null}>
        <Send aria-hidden="true" />
        发送测试邮件
      </Button>
      {message ? (
        <span className="text-sm text-muted-foreground" role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}

export function WorkerReplayButton({
  failureId,
  requiresDuplicateRiskAcknowledgement = false,
}: {
  failureId: string;
  requiresDuplicateRiskAcknowledgement?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const replay = async (acknowledgeDuplicateRisk = false) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/worker/failures/${failureId}/replay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acknowledgeDuplicateRisk }),
      });
      const result = (await response.json().catch(() => null)) as { code?: string } | null;
      setMessage(response.ok ? "已登记重放。" : `重放失败：${result?.code ?? response.status}`);
      if (response.ok) router.refresh();
    } catch {
      setMessage("重放失败：网络请求未完成。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {requiresDuplicateRiskAcknowledgement ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={busy}>
              <RefreshCw aria-hidden="true" />
              {busy ? "登记中" : "确认风险后重放"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认可能重复投递？</AlertDialogTitle>
              <AlertDialogDescription>
                SMTP
                是否已接受这封邮件没有确定结果。再次投递可能让收件人收到重复邮件；确认后才会登记重放。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => replay(true)}>确认风险并重放</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => replay()} disabled={busy}>
          <RefreshCw aria-hidden="true" />
          {busy ? "登记中" : "重放"}
        </Button>
      )}
      {message ? (
        <span className="text-xs text-muted-foreground" role="status">
          {message}
        </span>
      ) : null}
    </div>
  );
}
