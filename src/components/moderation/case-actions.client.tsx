"use client";

import { CheckCircle2, LoaderCircle, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import { useState } from "react";
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

type ActionOption = { value: string; label: string; duration: boolean };

export function ModerationCaseActions({
  caseNumber,
  targetType,
  isAdmin,
  isGlobalModerator,
  hasNode,
  sanctions,
}: {
  caseNumber: number;
  targetType: string;
  isAdmin: boolean;
  isGlobalModerator: boolean;
  hasNode: boolean;
  sanctions: Array<{ id: string; type: string; revokedAt: string | null }>;
}) {
  const contentActions: ActionOption[] =
    targetType === "topic"
      ? [
          { value: "hide", label: "隐藏主题", duration: false },
          { value: "restore", label: "恢复主题", duration: false },
          { value: "close", label: "关闭主题", duration: false },
        ]
      : targetType === "post"
        ? [
            { value: "hide", label: "隐藏回复", duration: false },
            { value: "restore", label: "恢复回复", duration: false },
          ]
        : [];
  const sanctionActions: ActionOption[] = [
    { value: "warn", label: "警告", duration: false },
    ...(hasNode ? [{ value: "node_mute", label: "节点禁言", duration: true }] : []),
    ...(isAdmin || isGlobalModerator
      ? [
          { value: "site_mute", label: "全站禁言", duration: true },
          { value: "suspend", label: "暂停账号", duration: true },
        ]
      : []),
    ...(isAdmin ? [{ value: "ban", label: "永久封禁", duration: false }] : []),
  ];
  const options = [...contentActions, ...sanctionActions];
  const [action, setAction] = useState(options[0]?.value ?? "warn");
  const [durationHours, setDurationHours] = useState("24");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const selected = options.find((option) => option.value === action);

  const request = async (url: string, method: string, body: unknown, kind: string) => {
    setPending(kind);
    setMessage("");
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as { code?: string };
    if (!response.ok) {
      setPending("");
      setMessage(`操作失败：${result.code ?? response.status}`);
      return;
    }
    window.location.reload();
  };

  const apply = () => {
    const hours = Number(durationHours);
    void request(
      `/api/admin/moderation/cases/${caseNumber}/actions`,
      "POST",
      {
        action,
        reason,
        ...(selected?.duration && Number.isInteger(hours) && hours > 0
          ? { durationHours: hours }
          : {}),
      },
      "action",
    );
  };

  const close = (outcome: "resolved" | "dismissed") => {
    void request(
      `/api/admin/moderation/cases/${caseNumber}`,
      "PATCH",
      { outcome, reason },
      outcome,
    );
  };

  const canAct = pending === "" && reason.trim().length >= 3;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-[minmax(11rem,0.75fr)_minmax(8rem,0.45fr)_minmax(0,1fr)]">
        <div className="grid gap-2">
          <Label htmlFor="moderation-action">处置动作</Label>
          <Select onValueChange={setAction} value={action}>
            <SelectTrigger className="w-full" id="moderation-action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selected?.duration ? (
          <div className="grid gap-2">
            <Label htmlFor="moderation-duration">有效小时数</Label>
            <Input
              id="moderation-duration"
              max={8760}
              min={1}
              onChange={(event) => setDurationHours(event.target.value)}
              type="number"
              value={durationHours}
            />
          </div>
        ) : (
          <div className="hidden md:block" />
        )}
        <div className="grid gap-2">
          <Label htmlFor="moderation-reason">处置理由</Label>
          <Input
            id="moderation-reason"
            maxLength={500}
            minLength={3}
            onChange={(event) => setReason(event.target.value)}
            placeholder="至少 3 个字"
            value={reason}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={!canAct} type="button">
              {pending === "action" ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <ShieldAlert aria-hidden="true" />
              )}
              执行处置
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认执行 {selected?.label}？</AlertDialogTitle>
              <AlertDialogDescription>
                该操作会对案件目标生效，并记录治理审计。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction disabled={!canAct} onClick={apply} variant="destructive">
                确认处置
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          disabled={!canAct}
          onClick={() => close("resolved")}
          type="button"
          variant="outline"
        >
          <CheckCircle2 aria-hidden="true" />
          结案
        </Button>
        <Button disabled={!canAct} onClick={() => close("dismissed")} type="button" variant="ghost">
          <XCircle aria-hidden="true" />
          驳回举报
        </Button>
      </div>

      {sanctions.some((sanction) => !sanction.revokedAt) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
          <span className="text-sm text-muted-foreground">有效制裁</span>
          {sanctions
            .filter((sanction) => !sanction.revokedAt)
            .map((sanction) => (
              <AlertDialog key={sanction.id}>
                <AlertDialogTrigger asChild>
                  <Button disabled={!canAct} size="sm" type="button" variant="outline">
                    <RotateCcw aria-hidden="true" />
                    撤销 {sanction.type}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>撤销 {sanction.type}？</AlertDialogTitle>
                    <AlertDialogDescription>
                      撤销同样会写入治理审计，且不会删除历史制裁记录。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={!canAct}
                      onClick={() =>
                        void request(
                          `/api/admin/moderation/sanctions/${sanction.id}`,
                          "DELETE",
                          { reason },
                          `revoke-${sanction.id}`,
                        )
                      }
                      variant="destructive"
                    >
                      确认撤销
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ))}
        </div>
      ) : null}

      {message ? (
        <Alert variant="destructive">
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
