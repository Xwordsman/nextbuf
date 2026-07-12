"use client";

import Link from "next/link";
import { GitBranch, LoaderCircle, LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";
import { authClient } from "@/components/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

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
      <form className="auth-form" onSubmit={submit}>
        <div className="form-field">
          <Label htmlFor="sign-in-email">邮箱</Label>
          <Input id="sign-in-email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="form-field">
          <div className="field-label-row">
            <Label htmlFor="sign-in-password">密码</Label>
            <Link href="/auth/forgot-password">忘记密码</Link>
          </div>
          <Input
            id="sign-in-password"
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={12}
            maxLength={128}
            required
          />
        </div>
        <label className="checkbox-field">
          <input name="rememberMe" type="checkbox" defaultChecked />
          <span>保持登录</span>
        </label>
        {message ? <p className="auth-message is-error">{message}</p> : null}
        <Button className="auth-submit" type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <LogIn />}
          登录
        </Button>
      </form>

      {githubEnabled ? (
        <div className="auth-provider-block">
          <div className="auth-divider">
            <Separator />
            <span>或</span>
            <Separator />
          </div>
          <Button
            type="button"
            variant="outline"
            className="auth-submit"
            onClick={signInWithGithub}
          >
            <GitBranch /> 使用 GitHub 登录
          </Button>
        </div>
      ) : null}

      <p className="auth-switch">
        没有账号？{" "}
        {registrationOpen ? <Link href="/auth/sign-up">创建账号</Link> : "当前未开放注册"}
      </p>
      <p className="auth-secondary-link">
        <Link href="/auth/check-email">重新发送验证邮件</Link>
      </p>
    </>
  );
}
