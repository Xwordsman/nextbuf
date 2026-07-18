"use client";

import Link from "next/link";
import { LoaderCircle, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Alert, AlertDescription } from "@/components/shadcn/ui/alert";
import { Button } from "@/components/shadcn/ui/button";
import { Input } from "@/components/shadcn/ui/input";
import { Label } from "@/components/shadcn/ui/label";

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
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor="forgot-email">邮箱</Label>
        <Input
          className="h-9"
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </div>
      {sent ? (
        <Alert role="status" className="border-emerald-200 bg-emerald-50 text-emerald-950">
          <AlertDescription className="text-emerald-800">
            如果账号存在，重置邮件已经发送。
          </AlertDescription>
        </Alert>
      ) : null}
      <Button className="w-full" size="lg" type="submit" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" /> : <Mail />}
        发送重置邮件
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        <Link className="underline underline-offset-4 hover:text-foreground" href="/auth/sign-in">
          返回登录
        </Link>
      </p>
    </form>
  );
}
