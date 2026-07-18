"use client";

import Link from "next/link";
import { KeyRound, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Alert, AlertDescription } from "@/components/shadcn/ui/alert";
import { Button } from "@/components/shadcn/ui/button";
import { Input } from "@/components/shadcn/ui/input";
import { Label } from "@/components/shadcn/ui/label";

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setMessage("两次输入的密码不一致。");
      return;
    }

    setPending(true);
    setMessage("");
    const result = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (result.error) {
      setMessage("重置链接无效或已经过期，请重新申请。");
      return;
    }
    setComplete(true);
  };

  if (complete) {
    return (
      <div className="grid gap-4">
        <Alert role="status" className="border-emerald-200 bg-emerald-50 text-emerald-950">
          <AlertDescription className="text-emerald-800">
            密码已更新，其他登录会话已经失效。
          </AlertDescription>
        </Alert>
        <Button asChild className="w-full" size="lg">
          <Link href="/auth/sign-in?reset=1">使用新密码登录</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor="reset-password">新密码</Label>
        <Input
          className="h-9"
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="reset-confirm">确认新密码</Label>
        <Input
          className="h-9"
          id="reset-confirm"
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
        {pending ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
        更新密码
      </Button>
    </form>
  );
}
