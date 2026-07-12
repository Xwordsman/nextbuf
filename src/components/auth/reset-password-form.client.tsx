"use client";

import Link from "next/link";
import { KeyRound, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      <div className="auth-result">
        <p className="auth-message is-success">密码已更新，其他登录会话已经失效。</p>
        <Button asChild className="auth-submit">
          <Link href="/auth/sign-in?reset=1">使用新密码登录</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="form-field">
        <Label htmlFor="reset-password">新密码</Label>
        <Input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </div>
      <div className="form-field">
        <Label htmlFor="reset-confirm">确认新密码</Label>
        <Input
          id="reset-confirm"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </div>
      {message ? <p className="auth-message is-error">{message}</p> : null}
      <Button className="auth-submit" type="submit" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
        更新密码
      </Button>
    </form>
  );
}
