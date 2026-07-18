"use client";

import { Save } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/shadcn/ui/button";
import { Switch } from "@/components/shadcn/ui/switch";
import type { NotificationPreferenceView } from "@/modules/notifications/contracts";

export function NotificationPreferences({ initial }: { initial: NotificationPreferenceView[] }) {
  const [preferences, setPreferences] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const toggle = (type: string, channel: "inAppEnabled" | "emailEnabled") => {
    setPreferences((current) =>
      current.map((item) => (item.type === type ? { ...item, [channel]: !item[channel] } : item)),
    );
    setStatus("idle");
  };

  const save = async () => {
    setStatus("saving");
    const response = await fetch("/api/account/notification-preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        preferences: preferences.map(({ type, inAppEnabled, emailEnabled }) => ({
          type,
          inAppEnabled,
          emailEnabled,
        })),
      }),
    });
    setStatus(response.ok ? "saved" : "error");
  };

  return (
    <div className="grid">
      <div
        className="hidden grid-cols-[minmax(0,1fr)_76px_76px] gap-3 border-b bg-muted/40 px-5 py-2.5 text-xs font-medium text-muted-foreground sm:grid sm:px-6"
        aria-hidden="true"
      >
        <span>类型</span>
        <span className="text-center">站内</span>
        <span className="text-center">邮件</span>
      </div>

      <div className="divide-y">
        {preferences.map((item) => {
          const inAppId = `notification-${item.type}-in-app`;
          const emailId = `notification-${item.type}-email`;
          return (
            <div
              className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_76px_76px] sm:items-center sm:px-6"
              key={item.type}
            >
              <strong className="text-sm font-medium text-foreground">{item.label}</strong>
              <div className="flex items-center justify-between gap-3 sm:justify-center">
                <label htmlFor={inAppId} className="text-xs text-muted-foreground sm:sr-only">
                  {item.label}站内通知
                </label>
                <Switch
                  id={inAppId}
                  checked={item.inAppEnabled}
                  onCheckedChange={() => toggle(item.type, "inAppEnabled")}
                  aria-label={`${item.label}站内通知`}
                />
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-center">
                <label htmlFor={emailId} className="text-xs text-muted-foreground sm:sr-only">
                  {item.label}邮件通知
                </label>
                <Switch
                  id={emailId}
                  checked={item.emailEnabled}
                  onCheckedChange={() => toggle(item.type, "emailEnabled")}
                  aria-label={`${item.label}邮件通知`}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-t bg-muted/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-xs leading-5 text-muted-foreground">
          邮箱验证和密码重置邮件不受常规通知偏好影响。
        </p>
        <Button type="button" onClick={save} disabled={status === "saving"}>
          <Save aria-hidden="true" /> {status === "saving" ? "保存中" : "保存偏好"}
        </Button>
      </div>
      <p className="min-h-6 px-5 py-2 text-xs text-muted-foreground sm:px-6" role="status">
        {status === "saved" ? "通知偏好已保存。" : status === "error" ? "保存失败，请重试。" : ""}
      </p>
    </div>
  );
}
