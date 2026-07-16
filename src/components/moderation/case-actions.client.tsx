"use client";

import { CheckCircle2, LoaderCircle, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  return (
    <div className="moderation-action-panel">
      <div className="moderation-action-fields">
        <div>
          <Label htmlFor="moderation-action">处置动作</Label>
          <select
            id="moderation-action"
            className="moderation-select"
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            {options.map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {selected?.duration ? (
          <div>
            <Label htmlFor="moderation-duration">有效小时数</Label>
            <Input
              id="moderation-duration"
              type="number"
              min={1}
              max={8760}
              value={durationHours}
              onChange={(event) => setDurationHours(event.target.value)}
            />
          </div>
        ) : null}
        <div className="moderation-reason-field">
          <Label htmlFor="moderation-reason">处置理由</Label>
          <Input
            id="moderation-reason"
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="至少 3 个字"
          />
        </div>
      </div>
      <div className="moderation-action-buttons">
        <Button type="button" onClick={apply} disabled={pending !== "" || reason.trim().length < 3}>
          {pending === "action" ? <LoaderCircle className="animate-spin" /> : <ShieldAlert />}
          执行处置
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => close("resolved")}
          disabled={pending !== "" || reason.trim().length < 3}
        >
          <CheckCircle2 />
          结案
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => close("dismissed")}
          disabled={pending !== "" || reason.trim().length < 3}
        >
          <XCircle />
          驳回举报
        </Button>
      </div>
      {sanctions.some((sanction) => !sanction.revokedAt) ? (
        <div className="moderation-active-sanctions">
          {sanctions
            .filter((sanction) => !sanction.revokedAt)
            .map((sanction) => (
              <Button
                key={sanction.id}
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending !== "" || reason.trim().length < 3}
                onClick={() =>
                  void request(
                    `/api/admin/moderation/sanctions/${sanction.id}`,
                    "DELETE",
                    { reason },
                    `revoke-${sanction.id}`,
                  )
                }
              >
                {pending === `revoke-${sanction.id}` ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
                撤销 {sanction.type}
              </Button>
            ))}
        </div>
      ) : null}
      {message ? <p className="field-error">{message}</p> : null}
    </div>
  );
}
