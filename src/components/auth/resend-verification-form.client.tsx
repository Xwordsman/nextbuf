"use client";

import Link from "next/link";
import { LoaderCircle, MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Alert, AlertDescription } from "@/components/shadcn/ui/alert";
import { Button } from "@/components/shadcn/ui/button";
import { Input } from "@/components/shadcn/ui/input";
import { Label } from "@/components/shadcn/ui/label";

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
    <form className="grid gap-4" onSubmit={submit}>
      {sent ? (
        <Alert role="status" className="border-emerald-200 bg-emerald-50 text-emerald-950">
          <AlertDescription className="text-emerald-800">
            如果邮箱对应未验证账号，验证邮件已经发送。
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor="verification-email">邮箱</Label>
        <Input
          className="h-9"
          id="verification-email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      <Button className="w-full" size="lg" type="submit" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <MailCheck />}
        重新发送验证邮件
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link className="underline underline-offset-4 hover:text-foreground" href="/auth/sign-in">
          返回登录
        </Link>
      </p>
    </form>
  );
}
