"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { CheckCircle2, PlugZap, Save, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/admin/ui/alert";
import { Badge } from "@/components/admin/ui/badge";
import { Button } from "@/components/admin/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/ui/card";
import { Input } from "@/components/admin/ui/input";
import { Label } from "@/components/admin/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/admin/ui/select";
import { Switch } from "@/components/admin/ui/switch";
import { Textarea } from "@/components/admin/ui/textarea";
import type { SiteSettingsInput } from "@/modules/settings/contracts";
import { SITE_SETTINGS_CONFIRMATION, TRUST_CHANGE_CONFIRMATION } from "@/shared/admin-contracts";

type SiteSettings = SiteSettingsInput & { revision: number; updatedAt: Date | null };
type SerializedSiteSettings = Omit<SiteSettings, "updatedAt"> & { updatedAt: string | null };
type ProviderStatus = {
  mail: {
    configured: boolean;
    host: string | null;
    port: number;
    secure: boolean;
    user: string | null;
    passwordConfigured: boolean;
    from: string;
  };
  storage: {
    configured: boolean;
    driver: string;
    localPath: string | null;
    endpoint: string | null;
    region: string | null;
    bucket: string | null;
    accessKey: string | null;
    secretConfigured: boolean;
  };
  github: {
    configured: boolean;
    clientId: string | null;
    secretConfigured: boolean;
    callbackUrl: string;
  };
};
type TrustRule = {
  id: string;
  version: number;
  status: string;
  config: unknown;
  activatedAt: Date | null;
  createdAt: Date;
};
type TrustBatch = {
  id: string;
  mode: string;
  status: string;
  processedUsers: number;
  totalUsers: number;
  createdAt: Date;
  ruleVersionId: string;
};

export type AdminSettingsSection = "general" | "providers" | "trust";

async function reauthenticate(password: string) {
  return fetch("/api/admin/reauthenticate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

function SettingSwitch({
  checked,
  description,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onCheckedChange: (value: boolean) => void;
}) {
  const switchId = useId();

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="grid gap-1">
        <Label htmlFor={switchId}>{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} id={switchId} onCheckedChange={onCheckedChange} />
    </div>
  );
}

export function AdminSettings({
  section,
  settings: initial,
  providers,
  rules,
  batches,
}: {
  section: AdminSettingsSection;
  settings: SiteSettings;
  providers: ProviderStatus;
  rules: TrustRule[];
  batches: TrustBatch[];
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const activeRule = rules.find((rule) => rule.status === "active") ?? rules[0];
  const [config, setConfig] = useState(JSON.stringify(activeRule?.config ?? {}, null, 2));

  const saveSettings = async () => {
    setBusy("settings");
    setMessage("");
    if (!(await reauthenticate(password)).ok) {
      setMessage("二次验证失败。");
      setBusy("");
      return;
    }
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: settings.revision,
        confirmation: SITE_SETTINGS_CONFIRMATION,
        reason,
        settings: {
          siteName: settings.siteName,
          registrationMode: settings.registrationMode,
          topicsEnabled: settings.topicsEnabled,
          repliesEnabled: settings.repliesEnabled,
          uploadsEnabled: settings.uploadsEnabled,
          maxTopicsPerHour: settings.maxTopicsPerHour,
          maxRepliesPerHour: settings.maxRepliesPerHour,
          maxUploadsPerHour: settings.maxUploadsPerHour,
        },
      }),
    });
    const result = (await response.json().catch(() => null)) as {
      code?: string;
      settings?: SerializedSiteSettings;
    } | null;
    setMessage(response.ok ? "站点设置已保存。" : `保存失败：${result?.code ?? response.status}`);
    setBusy("");
    if (response.ok) {
      if (result?.settings) {
        setSettings({
          ...result.settings,
          updatedAt: result.settings.updatedAt ? new Date(result.settings.updatedAt) : null,
        });
      }
      setPassword("");
      router.refresh();
    }
  };

  const testProvider = async (provider: "mail" | "storage" | "github") => {
    setBusy(provider);
    setMessage("");
    const response = await fetch(`/api/admin/providers/${provider}/test`, { method: "POST" });
    const result = (await response.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
      code?: string;
    } | null;
    setMessage(
      result?.ok
        ? `${provider} 连接成功。`
        : `${provider} 连接失败：${result?.message ?? result?.code ?? response.status}`,
    );
    setBusy("");
  };

  const createRule = async () => {
    setBusy("rule-create");
    setMessage("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(config);
    } catch {
      setMessage("规则 JSON 格式无效。");
      setBusy("");
      return;
    }
    const response = await fetch("/api/admin/governance/trust/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: parsed, reason }),
    });
    const result = (await response.json().catch(() => null)) as { code?: string } | null;
    setMessage(response.ok ? "规则草稿已创建。" : `创建失败：${result?.code ?? response.status}`);
    setBusy("");
    if (response.ok) router.refresh();
  };

  const previewRule = async (id: string) => {
    setBusy(`preview:${id}`);
    setMessage("");
    const response = await fetch(`/api/admin/governance/trust/rules/${id}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const result = (await response.json().catch(() => null)) as { code?: string } | null;
    setMessage(
      response.ok ? "预览批次已进入 Outbox。" : `预览失败：${result?.code ?? response.status}`,
    );
    setBusy("");
    if (response.ok) router.refresh();
  };

  const activateRule = async (id: string) => {
    setBusy(`activate:${id}`);
    setMessage("");
    if (!(await reauthenticate(password)).ok) {
      setMessage("二次验证失败。");
      setBusy("");
      return;
    }
    const response = await fetch(`/api/admin/governance/trust/rules/${id}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, confirmation: TRUST_CHANGE_CONFIRMATION }),
    });
    const result = (await response.json().catch(() => null)) as { code?: string } | null;
    setMessage(
      response.ok ? "规则已激活，应用批次已创建。" : `激活失败：${result?.code ?? response.status}`,
    );
    setBusy("");
    if (response.ok) {
      setPassword("");
      router.refresh();
    }
  };

  return (
    <div className="space-y-6">
      {section === "general" ? (
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <SlidersHorizontal aria-hidden="true" className="size-4" />
                  站点运营设置
                </CardTitle>
                <CardDescription>修改会进入治理审计，并要求当前管理员重新验证。</CardDescription>
              </div>
              <Badge variant="outline">修订 {settings.revision}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="site-name">站点名称</Label>
                <Input
                  id="site-name"
                  onChange={(event) => setSettings({ ...settings, siteName: event.target.value })}
                  value={settings.siteName}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="registration-mode">注册策略</Label>
                <Select
                  onValueChange={(registrationMode) =>
                    setSettings({
                      ...settings,
                      registrationMode: registrationMode as SiteSettings["registrationMode"],
                    })
                  }
                  value={settings.registrationMode}
                >
                  <SelectTrigger className="w-full" id="registration-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">开放</SelectItem>
                    <SelectItem value="invite">邀请</SelectItem>
                    <SelectItem value="closed">关闭</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="topic-limit">每小时主题上限</Label>
                <Input
                  id="topic-limit"
                  max={100}
                  min={1}
                  onChange={(event) =>
                    setSettings({ ...settings, maxTopicsPerHour: Number(event.target.value) })
                  }
                  type="number"
                  value={settings.maxTopicsPerHour}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="reply-limit">每小时回复上限</Label>
                <Input
                  id="reply-limit"
                  max={500}
                  min={1}
                  onChange={(event) =>
                    setSettings({ ...settings, maxRepliesPerHour: Number(event.target.value) })
                  }
                  type="number"
                  value={settings.maxRepliesPerHour}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="upload-limit">每小时上传上限</Label>
                <Input
                  id="upload-limit"
                  max={200}
                  min={1}
                  onChange={(event) =>
                    setSettings({ ...settings, maxUploadsPerHour: Number(event.target.value) })
                  }
                  type="number"
                  value={settings.maxUploadsPerHour}
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <SettingSwitch
                checked={settings.topicsEnabled}
                description="关闭后普通成员不能发布主题。"
                label="允许发布主题"
                onCheckedChange={(topicsEnabled) => setSettings({ ...settings, topicsEnabled })}
              />
              <SettingSwitch
                checked={settings.repliesEnabled}
                description="关闭后普通成员不能发布回复。"
                label="允许发布回复"
                onCheckedChange={(repliesEnabled) => setSettings({ ...settings, repliesEnabled })}
              />
              <SettingSwitch
                checked={settings.uploadsEnabled}
                description="关闭后普通成员不能上传附件。"
                label="允许上传附件"
                onCheckedChange={(uploadsEnabled) => setSettings({ ...settings, uploadsEnabled })}
              />
            </div>

            <div className="grid gap-3 border-t pt-6 md:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto] md:items-end">
              <div className="grid gap-2">
                <Label htmlFor="settings-reason">变更原因</Label>
                <Input
                  id="settings-reason"
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="至少 3 个字符"
                  value={reason}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="settings-password">管理员密码</Label>
                <Input
                  autoComplete="current-password"
                  id="settings-password"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </div>
              <Button
                disabled={Boolean(busy) || reason.trim().length < 3 || !password}
                onClick={saveSettings}
                type="button"
              >
                <Save aria-hidden="true" />
                {busy === "settings" ? "保存中" : "保存设置"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {section === "providers" ? (
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <PlugZap aria-hidden="true" className="size-4" />
                  Provider 配置状态
                </CardTitle>
                <CardDescription>完整密钥不进入浏览器，页面只显示脱敏状态。</CardDescription>
              </div>
              <Badge variant="outline">密钥不返回浏览器</Badge>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            <div className="divide-y">
              {[
                {
                  key: "mail" as const,
                  title: "SMTP 邮件",
                  configured: providers.mail.configured,
                  detail: `${providers.mail.host ?? "未配置"}:${providers.mail.port} · ${providers.mail.from}`,
                  meta: `用户 ${providers.mail.user ?? "无"} · 密码 ${providers.mail.passwordConfigured ? "已设置" : "未设置"}`,
                },
                {
                  key: "storage" as const,
                  title: "对象存储",
                  configured: providers.storage.configured,
                  detail: `${providers.storage.driver} · ${providers.storage.bucket ?? providers.storage.localPath ?? "未配置"}`,
                  meta: `${providers.storage.endpoint ?? "本地文件系统"} · 凭据 ${providers.storage.secretConfigured || providers.storage.driver === "local" ? "已就绪" : "未设置"}`,
                },
                {
                  key: "github" as const,
                  title: "GitHub OAuth",
                  configured: providers.github.configured,
                  detail: `Client ID ${providers.github.clientId ?? "未配置"}`,
                  meta: `${providers.github.callbackUrl} · Secret ${providers.github.secretConfigured ? "已设置" : "未设置"}`,
                },
              ].map((provider) => (
                <div
                  className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
                  key={provider.key}
                >
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <strong className="text-sm">{provider.title}</strong>
                      <Badge variant={provider.configured ? "secondary" : "outline"}>
                        {provider.configured ? "已配置" : "未配置"}
                      </Badge>
                    </div>
                    <span className="text-sm text-muted-foreground">{provider.detail}</span>
                    <span className="text-xs text-muted-foreground">{provider.meta}</span>
                  </div>
                  <Button
                    disabled={Boolean(busy) || !provider.configured}
                    onClick={() => testProvider(provider.key)}
                    type="button"
                    variant="outline"
                  >
                    {busy === provider.key ? "测试中" : "连接测试"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {section === "trust" ? (
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" className="size-4" />
                  信任规则
                </CardTitle>
                <CardDescription>草稿必须先预览，且仅完成的预览才能激活。</CardDescription>
              </div>
              <Badge variant="outline">{rules.length} 个版本</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="trust-reason">操作原因</Label>
                <Input
                  id="trust-reason"
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="至少 3 个字符"
                  value={reason}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="trust-password">管理员密码</Label>
                <Input
                  autoComplete="current-password"
                  id="trust-password"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="trust-rule-json">规则 JSON</Label>
              <Textarea
                className="min-h-72 font-mono text-xs"
                id="trust-rule-json"
                onChange={(event) => setConfig(event.target.value)}
                value={config}
              />
            </div>
            <Button
              disabled={Boolean(busy) || reason.trim().length < 3}
              onClick={createRule}
              type="button"
              variant="outline"
            >
              {busy === "rule-create" ? "创建中" : "创建规则草稿"}
            </Button>
            <div className="divide-y border-t">
              {rules.map((rule) => {
                const preview = batches.find(
                  (batch) => batch.ruleVersionId === rule.id && batch.mode === "preview",
                );
                return (
                  <div
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                    key={rule.id}
                  >
                    <div className="grid gap-1">
                      <strong className="text-sm">
                        v{rule.version} · {rule.status}
                      </strong>
                      <span className="text-xs text-muted-foreground">
                        {rule.createdAt.toLocaleString("zh-CN")}
                        {preview
                          ? ` · 预览 ${preview.status} ${preview.processedUsers}/${preview.totalUsers}`
                          : ""}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {["draft", "previewed"].includes(rule.status) ? (
                        <Button
                          disabled={Boolean(busy) || reason.trim().length < 3}
                          onClick={() => previewRule(rule.id)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          预览
                        </Button>
                      ) : null}
                      {rule.status === "previewed" && preview?.status === "completed" ? (
                        <Button
                          disabled={Boolean(busy) || !password || reason.trim().length < 3}
                          onClick={() => activateRule(rule.id)}
                          size="sm"
                          type="button"
                        >
                          激活
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {message ? (
        <Alert>
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>操作结果</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
