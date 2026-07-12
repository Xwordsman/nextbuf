"use client";

import Link from "next/link";
import { LoaderCircle, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    await authClient.requestPasswordReset({
      email: String(form.get("email") ?? ""),
      redirectTo: "/auth/reset-password",
    });
    setPending(false);
    setSent(true);
  };

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="form-field">
        <Label htmlFor="forgot-email">邮箱</Label>
        <Input id="forgot-email" name="email" type="email" autoComplete="email" required />
      </div>
      {sent ? <p className="auth-message is-success">如果账号存在，重置邮件已经发送。</p> : null}
      <Button className="auth-submit" type="submit" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <Mail />}
        发送重置邮件
      </Button>
      <p className="auth-switch">
        <Link href="/auth/sign-in">返回登录</Link>
      </p>
    </form>
  );
}
