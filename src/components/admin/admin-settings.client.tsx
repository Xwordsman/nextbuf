"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SiteSettingsInput } from "@/modules/settings/contracts";
import { SITE_SETTINGS_CONFIRMATION, TRUST_CHANGE_CONFIRMATION } from "@/shared/admin-contracts";

type SiteSettings = SiteSettingsInput & { revision: number; updatedAt: Date | null };
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

async function reauthenticate(password: string) {
  return fetch("/api/admin/reauthenticate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export function AdminSettings({
  settings: initial,
  providers,
  rules,
  batches,
}: {
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
    const result = (await response.json().catch(() => null)) as { code?: string } | null;
    setMessage(response.ok ? "站点设置已保存。" : `保存失败：${result?.code ?? response.status}`);
    setBusy("");
    if (response.ok) {
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
    <div className="admin-settings-stack">
      <section className="panel admin-section-panel">
        <div className="admin-section-head">
          <h2>站点运营设置</h2>
          <span>修订 {settings.revision}</span>
        </div>
        <div className="admin-settings-grid">
          <label>
            站点名称
            <Input
              value={settings.siteName}
              onChange={(event) => setSettings({ ...settings, siteName: event.target.value })}
            />
          </label>
          <label>
            注册策略
            <select
              value={settings.registrationMode}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  registrationMode: event.target.value as SiteSettings["registrationMode"],
                })
              }
            >
              <option value="open">开放</option>
              <option value="invite">邀请</option>
              <option value="closed">关闭</option>
            </select>
          </label>
          <label>
            每小时主题上限
            <Input
              type="number"
              min={1}
              max={100}
              value={settings.maxTopicsPerHour}
              onChange={(event) =>
                setSettings({ ...settings, maxTopicsPerHour: Number(event.target.value) })
              }
            />
          </label>
          <label>
            每小时回复上限
            <Input
              type="number"
              min={1}
              max={500}
              value={settings.maxRepliesPerHour}
              onChange={(event) =>
                setSettings({ ...settings, maxRepliesPerHour: Number(event.target.value) })
              }
            />
          </label>
          <label>
            每小时上传上限
            <Input
              type="number"
              min={1}
              max={200}
              value={settings.maxUploadsPerHour}
              onChange={(event) =>
                setSettings({ ...settings, maxUploadsPerHour: Number(event.target.value) })
              }
            />
          </label>
        </div>
        <div className="admin-toggle-row">
          <label>
            <input
              type="checkbox"
              checked={settings.topicsEnabled}
              onChange={(event) =>
                setSettings({ ...settings, topicsEnabled: event.target.checked })
              }
            />{" "}
            允许发布主题
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.repliesEnabled}
              onChange={(event) =>
                setSettings({ ...settings, repliesEnabled: event.target.checked })
              }
            />{" "}
            允许发布回复
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.uploadsEnabled}
              onChange={(event) =>
                setSettings({ ...settings, uploadsEnabled: event.target.checked })
              }
            />{" "}
            允许上传附件
          </label>
        </div>
        <div className="admin-action-credentials">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="变更原因"
          />
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="管理员密码"
            autoComplete="current-password"
          />
          <Button
            type="button"
            onClick={saveSettings}
            disabled={Boolean(busy) || reason.trim().length < 3 || !password}
          >
            {busy === "settings" ? "保存中" : "保存设置"}
          </Button>
        </div>
      </section>

      <section className="panel admin-section-panel">
        <div className="admin-section-head">
          <h2>Provider 配置状态</h2>
          <span>密钥不返回浏览器</span>
        </div>
        <div className="admin-provider-list">
          <article>
            <div>
              <strong>SMTP 邮件</strong>
              <span>
                {providers.mail.host ?? "未配置"}:{providers.mail.port} · {providers.mail.from}
              </span>
              <small>
                用户 {providers.mail.user ?? "无"} · 密码{" "}
                {providers.mail.passwordConfigured ? "已设置" : "未设置"}
              </small>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy) || !providers.mail.configured}
              onClick={() => testProvider("mail")}
            >
              {busy === "mail" ? "测试中" : "连接测试"}
            </Button>
          </article>
          <article>
            <div>
              <strong>对象存储</strong>
              <span>
                {providers.storage.driver} ·{" "}
                {providers.storage.bucket ?? providers.storage.localPath ?? "未配置"}
              </span>
              <small>
                {providers.storage.endpoint ?? "本地文件系统"} · 凭据{" "}
                {providers.storage.secretConfigured || providers.storage.driver === "local"
                  ? "已就绪"
                  : "未设置"}
              </small>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy) || !providers.storage.configured}
              onClick={() => testProvider("storage")}
            >
              {busy === "storage" ? "测试中" : "连接测试"}
            </Button>
          </article>
          <article>
            <div>
              <strong>GitHub OAuth</strong>
              <span>Client ID {providers.github.clientId ?? "未配置"}</span>
              <small>
                {providers.github.callbackUrl} · Secret{" "}
                {providers.github.secretConfigured ? "已设置" : "未设置"}
              </small>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy) || !providers.github.configured}
              onClick={() => testProvider("github")}
            >
              {busy === "github" ? "测试中" : "连接测试"}
            </Button>
          </article>
        </div>
      </section>

      <section className="panel admin-section-panel">
        <div className="admin-section-head">
          <h2>信任规则</h2>
          <span>{rules.length} 个版本</span>
        </div>
        <Textarea
          className="admin-rule-editor"
          value={config}
          onChange={(event) => setConfig(event.target.value)}
          aria-label="信任规则 JSON"
        />
        <div className="admin-panel-actions">
          <Button
            type="button"
            variant="outline"
            disabled={Boolean(busy) || reason.trim().length < 3}
            onClick={createRule}
          >
            {busy === "rule-create" ? "创建中" : "创建规则草稿"}
          </Button>
        </div>
        <div className="admin-rule-list">
          {rules.map((rule) => {
            const preview = batches.find(
              (batch) => batch.ruleVersionId === rule.id && batch.mode === "preview",
            );
            return (
              <article key={rule.id}>
                <div>
                  <strong>
                    v{rule.version} · {rule.status}
                  </strong>
                  <small>
                    {rule.createdAt.toLocaleString("zh-CN")}
                    {preview
                      ? ` · 预览 ${preview.status} ${preview.processedUsers}/${preview.totalUsers}`
                      : ""}
                  </small>
                </div>
                <div>
                  {["draft", "previewed"].includes(rule.status) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={Boolean(busy) || reason.trim().length < 3}
                      onClick={() => previewRule(rule.id)}
                    >
                      预览
                    </Button>
                  ) : null}
                  {rule.status === "previewed" && preview?.status === "completed" ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={Boolean(busy) || !password || reason.trim().length < 3}
                      onClick={() => activateRule(rule.id)}
                    >
                      激活
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <p className="admin-action-message" role="status">
        {message}
      </p>
    </div>
  );
}
