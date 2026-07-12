"use client";

import { Laptop, LoaderCircle, LogOut, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Button } from "@/components/ui/button";

export type SessionView = {
  token: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
};

function deviceName(userAgent: string | null): string {
  if (!userAgent) return "未知设备";
  const device = /mobile|android|iphone/i.test(userAgent) ? "移动设备" : "桌面设备";
  const browser = /edg\//i.test(userAgent)
    ? "Edge"
    : /firefox\//i.test(userAgent)
      ? "Firefox"
      : /chrome\//i.test(userAgent)
        ? "Chrome"
        : /safari\//i.test(userAgent)
          ? "Safari"
          : "浏览器";
  return `${device} · ${browser}`;
}

export function SessionManager({ initialSessions }: { initialSessions: SessionView[] }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [pendingToken, setPendingToken] = useState("");

  const revoke = async (token: string) => {
    setPendingToken(token);
    const result = await authClient.revokeSession({ token });
    setPendingToken("");
    if (!result.error)
      setSessions((current) => current.filter((session) => session.token !== token));
  };

  const revokeOthers = async () => {
    setPendingToken("others");
    const result = await authClient.revokeOtherSessions();
    setPendingToken("");
    if (!result.error) setSessions((current) => current.filter((session) => session.current));
  };

  const revokeAll = async () => {
    setPendingToken("all");
    await authClient.revokeSessions();
    window.location.assign("/auth/sign-in");
  };

  return (
    <div className="security-sections">
      <section className="security-section" aria-labelledby="sessions-title">
        <div className="security-section-head">
          <div>
            <h2 id="sessions-title">登录设备</h2>
            <p>会话到期后会自动失效，也可以在这里立即撤销。</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={revokeOthers}
            disabled={Boolean(pendingToken)}
          >
            {pendingToken === "others" ? <LoaderCircle className="animate-spin" /> : <LogOut />}
            退出其他设备
          </Button>
        </div>

        <div className="session-list">
          {sessions.map((session) => {
            const mobile = /mobile|android|iphone/i.test(session.userAgent ?? "");
            const Icon = mobile ? Smartphone : Laptop;
            return (
              <article className="session-item" key={session.token}>
                <span className="session-icon" aria-hidden="true">
                  <Icon />
                </span>
                <div className="session-copy">
                  <strong>
                    {deviceName(session.userAgent)} {session.current ? <span>当前设备</span> : null}
                  </strong>
                  <span>
                    {session.ipAddress ?? "IP 未记录"} · 登录于{" "}
                    {new Date(session.createdAt).toLocaleString("zh-CN")}
                  </span>
                  <small>有效至 {new Date(session.expiresAt).toLocaleString("zh-CN")}</small>
                </div>
                {!session.current ? (
                  <Button
                    type="button"
                    variant="danger"
                    size="icon"
                    aria-label={`撤销 ${deviceName(session.userAgent)}`}
                    onClick={() => revoke(session.token)}
                    disabled={Boolean(pendingToken)}
                  >
                    {pendingToken === session.token ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                  </Button>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="security-section danger-zone" aria-labelledby="all-sessions-title">
        <div>
          <h2 id="all-sessions-title">退出全部设备</h2>
          <p>包括当前设备在内的所有会话都会立即撤销。</p>
        </div>
        <Button type="button" variant="danger" onClick={revokeAll} disabled={Boolean(pendingToken)}>
          {pendingToken === "all" ? <LoaderCircle className="animate-spin" /> : <LogOut />}
          全部退出
        </Button>
      </section>
    </div>
  );
}
