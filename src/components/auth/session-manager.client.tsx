"use client";

import { Laptop, LoaderCircle, LogOut, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import { Separator } from "@/components/shadcn/ui/separator";

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
    <div className="grid gap-7 p-4 sm:p-5">
      <section className="grid gap-4" aria-labelledby="sessions-title">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <h2 id="sessions-title" className="text-base font-semibold">
              登录设备
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              会话到期后会自动失效，也可以在这里立即撤销。
            </p>
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

        <div className="overflow-hidden rounded-lg border">
          {sessions.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">暂无可管理的有效登录会话。</p>
          ) : (
            sessions.map((session) => {
              const mobile = /mobile|android|iphone/i.test(session.userAgent ?? "");
              const Icon = mobile ? Smartphone : Laptop;
              return (
                <article
                  className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-3 border-b p-4 last:border-b-0"
                  data-testid="session-item"
                  key={session.token}
                >
                  <span
                    className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                    aria-hidden="true"
                  >
                    <Icon className="size-4" />
                  </span>
                  <div className="grid min-w-0 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm font-medium">
                        {deviceName(session.userAgent)}
                      </strong>
                      {session.current ? <Badge variant="secondary">当前设备</Badge> : null}
                    </div>
                    <p className="text-sm leading-5 text-muted-foreground">
                      {session.ipAddress ?? "IP 未记录"} · 登录于{" "}
                      {new Date(session.createdAt).toLocaleString("zh-CN")}
                    </p>
                    <p className="text-xs leading-5 text-muted-foreground">
                      有效至 {new Date(session.expiresAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  {!session.current ? (
                    <Button
                      type="button"
                      variant="destructive"
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
            })
          )}
        </div>
      </section>

      <Separator />

      <section
        className="flex flex-col gap-4 rounded-lg border border-destructive/30 bg-destructive/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between"
        aria-labelledby="all-sessions-title"
      >
        <div>
          <h2 id="all-sessions-title" className="text-base font-semibold">
            退出全部设备
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            包括当前设备在内的所有会话都会立即撤销。
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          onClick={revokeAll}
          disabled={Boolean(pendingToken)}
        >
          {pendingToken === "all" ? <LoaderCircle className="animate-spin" /> : <LogOut />}
          全部退出
        </Button>
      </section>
    </div>
  );
}
