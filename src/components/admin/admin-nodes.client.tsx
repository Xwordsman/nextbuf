"use client";

import { Archive, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AdminNodeFormValue = {
  id: string;
  slug: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  sortOrder: number;
  visibility: string;
  archivedAt: Date | null;
  _count: { topics: number; roleAssignments: number };
};

const iconOptions = ["bot", "code", "server", "globe", "network", "sparkles", "grid"] as const;

export function AdminNodeForm({
  node,
  nextSortOrder,
}: {
  node?: AdminNodeFormValue;
  nextSortOrder: number;
}) {
  const router = useRouter();
  const isCreate = !node;
  const [form, setForm] = useState({
    slug: node?.slug ?? "",
    name: node?.name ?? "",
    description: node?.description ?? "",
    color: node?.color ?? "#2563eb",
    icon: node?.icon ?? "grid",
    sortOrder: node?.sortOrder ?? nextSortOrder,
    visibility: node?.visibility ?? "public",
    archived: Boolean(node?.archivedAt),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const payload = isCreate
      ? {
          slug: form.slug,
          name: form.name,
          description: form.description,
          color: form.color,
          icon: form.icon,
          sortOrder: form.sortOrder,
          visibility: form.visibility,
        }
      : {
          name: form.name,
          description: form.description,
          color: form.color,
          icon: form.icon,
          sortOrder: form.sortOrder,
          visibility: form.visibility,
          archived: form.archived,
        };
    const response = await fetch(
      isCreate ? "/api/community/nodes" : `/api/community/nodes/${node.slug}`,
      {
        method: isCreate ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = (await response.json().catch(() => null)) as {
      code?: string;
      slug?: string;
    } | null;
    setBusy(false);
    if (!response.ok) {
      const messages: Record<string, string> = {
        invalid_node: "请检查节点字段和格式。",
        node_conflict: "节点标识已经存在。",
        forbidden: "当前账号没有管理节点的权限。",
      };
      setMessage(messages[result?.code ?? ""] ?? `保存失败：${result?.code ?? response.status}`);
      return;
    }
    if (isCreate && result?.slug) {
      router.replace(`/admin/nodes/${result.slug}`);
      return;
    }
    setMessage("节点已保存。");
    router.refresh();
  };

  return (
    <form className="admin-node-form" onSubmit={submit}>
      {node ? (
        <div className="admin-node-identity">
          <span style={{ backgroundColor: form.color }} aria-hidden="true" />
          <div>
            <strong>{node.slug}</strong>
            <small>
              {node._count.topics} 个主题 · {node._count.roleAssignments} 个版主角色
            </small>
          </div>
        </div>
      ) : null}
      <div className="admin-node-form-grid">
        {isCreate ? (
          <div className="form-field">
            <Label htmlFor="node-slug">节点标识</Label>
            <Input
              id="node-slug"
              value={form.slug}
              minLength={2}
              maxLength={64}
              pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
              required
            />
          </div>
        ) : null}
        <div className="form-field">
          <Label htmlFor="node-name">名称</Label>
          <Input
            id="node-name"
            value={form.name}
            minLength={2}
            maxLength={80}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </div>
        <div className="form-field admin-node-form-wide">
          <Label htmlFor="node-description">简介</Label>
          <Input
            id="node-description"
            value={form.description}
            maxLength={500}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </div>
        <div className="form-field">
          <Label htmlFor="node-color">颜色</Label>
          <Input
            id="node-color"
            type="color"
            value={form.color}
            onChange={(event) => setForm({ ...form, color: event.target.value })}
          />
        </div>
        <div className="form-field">
          <Label htmlFor="node-icon">图标</Label>
          <select
            id="node-icon"
            value={form.icon}
            onChange={(event) => setForm({ ...form, icon: event.target.value })}
          >
            {iconOptions.map((icon) => (
              <option value={icon} key={icon}>
                {icon}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <Label htmlFor="node-sort-order">排序</Label>
          <Input
            id="node-sort-order"
            type="number"
            min={-10_000}
            max={10_000}
            value={form.sortOrder}
            onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })}
          />
        </div>
        <div className="form-field">
          <Label htmlFor="node-visibility">可见性</Label>
          <select
            id="node-visibility"
            value={form.visibility}
            onChange={(event) => setForm({ ...form, visibility: event.target.value })}
          >
            <option value="public">公开</option>
            <option value="hidden">隐藏</option>
          </select>
        </div>
      </div>
      {!isCreate ? (
        <label className="admin-node-archive-toggle">
          <input
            type="checkbox"
            checked={form.archived}
            onChange={(event) => setForm({ ...form, archived: event.target.checked })}
          />
          <span>
            <Archive aria-hidden="true" />
            归档节点
          </span>
          <small>归档保留主题与审计记录，不会删除已有内容。</small>
        </label>
      ) : null}
      <div className="admin-form-actions">
        <Button type="submit" disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Save />}
          {isCreate ? "创建节点" : "保存更改"}
        </Button>
        {message ? <span role="status">{message}</span> : null}
      </div>
    </form>
  );
}
