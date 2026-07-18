"use client";

import Link from "next/link";
import { GitBranch, LoaderCircle, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Alert, AlertDescription } from "@/components/shadcn/ui/alert";
import { Button } from "@/components/shadcn/ui/button";
import { Input } from "@/components/shadcn/ui/input";
import { Label } from "@/components/shadcn/ui/label";
import { Separator } from "@/components/shadcn/ui/separator";

export function SignUpForm({
  inviteRequired,
  githubEnabled,
}: {
  inviteRequired: boolean;
  githubEnabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setMessage("两次输入的密码不一致。");
      return;
    }

    setPending(true);
    const response = await fetch("/api/identity/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        username: form.get("username"),
        email: form.get("email"),
        password,
        inviteCode: form.get("inviteCode") || undefined,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { code?: string };
    setPending(false);

    if (!response.ok) {
      const messages: Record<string, string> = {
        invalid_registration: "请检查昵称、邮箱和密码。密码至少需要 12 个字符。",
        invalid_username: "用户名需为 3-24 位小写字母、数字或单下划线，并以字母开头。",
        reserved_username: "该用户名为系统保留名称，请更换。",
        username_unavailable: "该用户名已被使用或由历史用户保留。",
        invalid_invite: "邀请码无效、已过期或已达到使用次数。",
        registration_closed: "当前未开放注册。",
        installation_incomplete: "站点尚未完成首次安装。",
        registration_rate_limited: "操作过于频繁，请稍后再试。",
      };
      setMessage(messages[result.code ?? ""] ?? "暂时无法注册，请稍后再试。");
      return;
    }

    window.location.assign("/auth/check-email?sent=1");
  };

  const signInWithGithub = async () => {
    await authClient.signIn.social({ provider: "github", callbackURL: "/" });
  };

  return (
    <>
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-2">
          <Label htmlFor="sign-up-name">昵称</Label>
          <Input
            className="h-9"
            id="sign-up-name"
            name="name"
            autoComplete="name"
            minLength={2}
            maxLength={40}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sign-up-username">用户名</Label>
          <Input
            className="h-9"
            id="sign-up-username"
            name="username"
            autoComplete="username"
            minLength={3}
            maxLength={24}
            pattern="[a-z](?:[a-z0-9]|_(?!_)){1,22}[a-z0-9]"
            required
          />
          <p className="text-xs leading-5 text-muted-foreground">
            用于 @username 和个人主页链接，注册后 30 天内不可再次修改。
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sign-up-email">邮箱</Label>
          <Input
            className="h-9"
            id="sign-up-email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
        {inviteRequired ? (
          <div className="grid gap-2">
            <Label htmlFor="sign-up-invite">邀请码</Label>
            <Input
              className="h-9"
              id="sign-up-invite"
              name="inviteCode"
              autoComplete="off"
              required
            />
          </div>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="sign-up-password">密码</Label>
          <Input
            className="h-9"
            id="sign-up-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
          <p className="text-xs leading-5 text-muted-foreground">
            至少 12 个字符，建议使用密码管理器生成。
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="sign-up-confirm">确认密码</Label>
          <Input
            className="h-9"
            id="sign-up-confirm"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
          />
        </div>
        {message ? (
          <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        <Button className="w-full" size="lg" type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <UserPlus />}
          创建账号
        </Button>
      </form>

      {githubEnabled ? (
        <div className="grid gap-3 pt-5">
          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
            <Separator className="flex-1" />
            <span>或</span>
            <Separator className="flex-1" />
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            size="lg"
            onClick={signInWithGithub}
          >
            <GitBranch /> 使用 GitHub 注册
          </Button>
        </div>
      ) : null}

      <p className="mt-5 text-center text-sm text-muted-foreground">
        已有账号？{" "}
        <Link className="underline underline-offset-4 hover:text-foreground" href="/auth/sign-in">
          登录
        </Link>
      </p>
    </>
  );
}
