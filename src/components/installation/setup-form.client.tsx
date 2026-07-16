"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SetupForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);

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
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: form.get("token"),
        name: form.get("name"),
        username: form.get("username"),
        email: form.get("email"),
        password,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { code?: string };
    setPending(false);
    if (!response.ok) {
      const messages: Record<string, string> = {
        invalid_setup: "请检查安装令牌和管理员资料。",
        invalid_setup_token: "安装令牌不正确。",
        already_complete: "站点已经完成首次安装。",
        setup_disabled: "服务器未配置 SETUP_TOKEN。",
        setup_in_progress: "另一项安装请求正在执行，请稍后重试。",
        existing_users_require_recovery: "数据库中已有不兼容的用户数据，请按运行手册恢复。",
        invalid_username: "用户名格式不正确。",
        reserved_username: "该用户名为系统保留名称。",
      };
      setMessage(messages[result.code ?? ""] ?? "安装暂时失败，请查看 Web 日志。");
      return;
    }
    setComplete(true);
  };

  if (complete) {
    return (
      <div className="auth-message is-success" role="status">
        首位管理员已创建。请先完成邮箱验证，再登录后台；随后从部署配置中删除 SETUP_TOKEN 并重启
        Web。
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="form-field">
        <Label htmlFor="setup-token">一次性安装令牌</Label>
        <Input
          id="setup-token"
          name="token"
          type="password"
          autoComplete="off"
          minLength={32}
          required
        />
      </div>
      <div className="form-field">
        <Label htmlFor="setup-name">管理员昵称</Label>
        <Input
          id="setup-name"
          name="name"
          autoComplete="name"
          minLength={2}
          maxLength={40}
          required
        />
      </div>
      <div className="form-field">
        <Label htmlFor="setup-username">管理员用户名</Label>
        <Input
          id="setup-username"
          name="username"
          autoComplete="username"
          minLength={3}
          maxLength={24}
          pattern="[a-z](?:[a-z0-9]|_(?!_)){1,22}[a-z0-9]"
          required
        />
      </div>
      <div className="form-field">
        <Label htmlFor="setup-email">管理员邮箱</Label>
        <Input id="setup-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="form-field">
        <Label htmlFor="setup-password">管理员密码</Label>
        <Input
          id="setup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </div>
      <div className="form-field">
        <Label htmlFor="setup-confirm">确认密码</Label>
        <Input
          id="setup-confirm"
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
        {pending ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
        创建首位管理员
      </Button>
    </form>
  );
}
