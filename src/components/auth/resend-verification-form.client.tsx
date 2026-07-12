"use client";

import Link from "next/link";
import { LoaderCircle, MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResendVerificationForm({ initiallySent }: { initiallySent: boolean }) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(initiallySent);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    await authClient.sendVerificationEmail({
      email: String(form.get("email") ?? ""),
      callbackURL: "/auth/verified",
    });
    setPending(false);
    setSent(true);
  };

  return (
    <form className="auth-form" onSubmit={submit}>
      {sent ? (
        <p className="auth-message is-success">如果邮箱对应未验证账号，验证邮件已经发送。</p>
      ) : null}
      <div className="form-field">
        <Label htmlFor="verification-email">邮箱</Label>
        <Input id="verification-email" name="email" type="email" autoComplete="email" required />
      </div>
      <Button className="auth-submit" type="submit" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <MailCheck />}
        重新发送验证邮件
      </Button>
      <p className="auth-switch">
        <Link href="/auth/sign-in">返回登录</Link>
      </p>
    </form>
  );
}
