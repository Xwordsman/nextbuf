"use client";

import Link from "next/link";
import { GitBranch, LoaderCircle, LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Alert, AlertDescription } from "@/components/shadcn/ui/alert";
import { Button } from "@/components/shadcn/ui/button";
import { Checkbox } from "@/components/shadcn/ui/checkbox";
import { Input } from "@/components/shadcn/ui/input";
import { Label } from "@/components/shadcn/ui/label";
import { Separator } from "@/components/shadcn/ui/separator";

function safeNextPath(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export function SignInForm({
  nextPath,
  registrationOpen,
  githubEnabled,
}: {
  nextPath: string;
  registrationOpen: boolean;
  githubEnabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      rememberMe: form.get("rememberMe") === "on",
    });
    setPending(false);

    if (result.error) {
      setMessage("邮箱或密码错误，或者邮箱尚未完成验证。");
      return;
    }
    window.location.assign(safeNextPath(nextPath));
  };

  const signInWithGithub = async () => {
    await authClient.signIn.social({ provider: "github", callbackURL: safeNextPath(nextPath) });
  };

  return (
    <>
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-2">
          <Label htmlFor="sign-in-email">邮箱</Label>
          <Input
            className="h-9"
            id="sign-in-email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="sign-in-password">密码</Label>
            <Link
              className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
              href="/auth/forgot-password"
            >
              忘记密码
            </Link>
          </div>
          <Input
            className="h-9"
            id="sign-in-password"
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={12}
            maxLength={128}
            required
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="remember-me" name="rememberMe" defaultChecked />
          <Label
            className="cursor-pointer text-sm font-normal text-muted-foreground"
            htmlFor="remember-me"
          >
            保持登录
          </Label>
        </div>
        {message ? (
          <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        <Button className="w-full" size="lg" type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <LogIn />}
          登录
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
            <GitBranch /> 使用 GitHub 登录
          </Button>
        </div>
      ) : null}

      <p className="mt-5 text-center text-sm text-muted-foreground">
        没有账号？{" "}
        {registrationOpen ? (
          <Link className="underline underline-offset-4 hover:text-foreground" href="/auth/sign-up">
            创建账号
          </Link>
        ) : (
          "当前未开放注册"
        )}
      </p>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        <Link
          className="underline underline-offset-4 hover:text-foreground"
          href="/auth/check-email"
        >
          重新发送验证邮件
        </Link>
      </p>
    </>
  );
}
