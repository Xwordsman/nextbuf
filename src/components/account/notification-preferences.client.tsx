"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import type { NotificationPreferenceView } from "@/modules/notifications/contracts";
import { Button } from "@/components/ui/button";

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
    <div className="notification-preferences">
      <div className="notification-preference-head" aria-hidden="true">
        <span>类型</span>
        <span>站内</span>
        <span>邮件</span>
      </div>
      {preferences.map((item) => (
        <div className="notification-preference-row" key={item.type}>
          <strong>{item.label}</strong>
          <label>
            <span className="sr-only">{item.label}站内通知</span>
            <input
              type="checkbox"
              checked={item.inAppEnabled}
              onChange={() => toggle(item.type, "inAppEnabled")}
            />
          </label>
          <label>
            <span className="sr-only">{item.label}邮件通知</span>
            <input
              type="checkbox"
              checked={item.emailEnabled}
              onChange={() => toggle(item.type, "emailEnabled")}
            />
          </label>
        </div>
      ))}
      <div className="notification-preference-footer">
        <p>邮箱验证和密码重置邮件不受普通通知偏好影响。</p>
        <Button type="button" onClick={save} disabled={status === "saving"}>
          <Save /> {status === "saving" ? "保存中" : "保存偏好"}
        </Button>
      </div>
      <p className="form-status" role="status">
        {status === "saved" ? "通知偏好已保存。" : status === "error" ? "保存失败，请重试。" : ""}
      </p>
    </div>
  );
}
