"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type NodeItem = {
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

const iconOptions = ["bot", "code", "server", "globe", "network", "sparkles", "grid"];

function NodeCreator({ sortOrder }: { sortOrder: number }) {
  const router = useRouter();
  const [form, setForm] = useState({
    slug: "",
    name: "",
    description: "",
    color: "#2563eb",
    icon: "grid",
    sortOrder,
    visibility: "public",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/community/nodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const result = (await response.json().catch(() => null)) as { code?: string } | null;
    setBusy(false);
    if (!response.ok) {
      const messages: Record<string, string> = {
        invalid_node: "请检查节点标识和字段格式。",
        node_conflict: "节点标识已经存在。",
        forbidden: "当前账号没有创建节点的权限。",
      };
      setMessage(messages[result?.code ?? ""] ?? `创建失败：${result?.code ?? response.status}`);
      return;
    }
    setForm({
      slug: "",
      name: "",
      description: "",
      color: "#2563eb",
      icon: "grid",
      sortOrder: form.sortOrder + 10,
      visibility: "public",
    });
    setMessage("节点已创建。");
    router.refresh();
  };

  return (
    <section className="admin-node-create">
      <h2>创建节点</h2>
      <form className="admin-node-create-form" onSubmit={submit}>
        <div className="admin-node-create-field">
          <Label htmlFor="node-create-slug">节点标识</Label>
          <Input
            id="node-create-slug"
            value={form.slug}
            minLength={2}
            maxLength={64}
            pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
            onChange={(event) => setForm({ ...form, slug: event.target.value })}
            required
          />
        </div>
        <div className="admin-node-create-field">
          <Label htmlFor="node-create-name">名称</Label>
          <Input
            id="node-create-name"
            value={form.name}
            minLength={2}
            maxLength={80}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </div>
        <div className="admin-node-create-field is-wide">
          <Label htmlFor="node-create-description">简介</Label>
          <Input
            id="node-create-description"
            value={form.description}
            maxLength={500}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </div>
        <div className="admin-node-create-field">
          <Label htmlFor="node-create-color">颜色</Label>
          <Input
            id="node-create-color"
            type="color"
            value={form.color}
            onChange={(event) => setForm({ ...form, color: event.target.value })}
          />
        </div>
        <div className="admin-node-create-field">
          <Label htmlFor="node-create-icon">图标</Label>
          <select
            id="node-create-icon"
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
        <div className="admin-node-create-field">
          <Label htmlFor="node-create-sort">排序</Label>
          <Input
            id="node-create-sort"
            type="number"
            min={-10_000}
            max={10_000}
            value={form.sortOrder}
            onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })}
          />
        </div>
        <div className="admin-node-create-field">
          <Label htmlFor="node-create-visibility">可见性</Label>
          <select
            id="node-create-visibility"
            value={form.visibility}
            onChange={(event) => setForm({ ...form, visibility: event.target.value })}
          >
            <option value="public">public</option>
            <option value="hidden">hidden</option>
          </select>
        </div>
        <Button type="submit" disabled={busy}>
          <Plus />
          {busy ? "创建中" : "创建节点"}
        </Button>
        {message ? <span role="status">{message}</span> : null}
      </form>
    </section>
  );
}

function NodeEditor({ node }: { node: NodeItem }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: node.name,
    description: node.description,
    color: node.color,
    icon: node.icon,
    sortOrder: node.sortOrder,
    visibility: node.visibility,
    archived: Boolean(node.archivedAt),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const save = async () => {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/community/nodes/${node.slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const result = (await response.json().catch(() => null)) as { code?: string } | null;
    setMessage(response.ok ? "已保存" : `失败：${result?.code ?? response.status}`);
    setBusy(false);
    if (response.ok) router.refresh();
  };
  return (
    <article className="admin-node-row">
      <div className="admin-node-title">
        <span style={{ backgroundColor: form.color }} />
        <div>
          <strong>{node.slug}</strong>
          <small>
            {node._count.topics} 个主题 · {node._count.roleAssignments} 个版主角色
          </small>
        </div>
      </div>
      <div className="admin-node-fields">
        <Input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          aria-label={`${node.slug} 名称`}
        />
        <Input
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          aria-label={`${node.slug} 简介`}
        />
        <Input
          type="color"
          value={form.color}
          onChange={(event) => setForm({ ...form, color: event.target.value })}
          aria-label={`${node.slug} 颜色`}
        />
        <select
          value={form.icon}
          onChange={(event) => setForm({ ...form, icon: event.target.value })}
          aria-label={`${node.slug} 图标`}
        >
          {iconOptions.map((icon) => (
            <option value={icon} key={icon}>
              {icon}
            </option>
          ))}
        </select>
        <Input
          type="number"
          value={form.sortOrder}
          onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })}
          aria-label={`${node.slug} 排序`}
        />
        <select
          value={form.visibility}
          onChange={(event) => setForm({ ...form, visibility: event.target.value })}
          aria-label={`${node.slug} 可见性`}
        >
          <option value="public">public</option>
          <option value="hidden">hidden</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={form.archived}
            onChange={(event) => setForm({ ...form, archived: event.target.checked })}
          />{" "}
          归档
        </label>
        <Button type="button" size="sm" disabled={busy} onClick={save}>
          {busy ? "保存中" : "保存"}
        </Button>
        <span role="status">{message}</span>
      </div>
    </article>
  );
}

export function AdminNodes({ nodes }: { nodes: NodeItem[] }) {
  const sortOrder = nodes.reduce((maximum, node) => Math.max(maximum, node.sortOrder), 0) + 10;
  return (
    <div className="admin-node-list">
      <NodeCreator sortOrder={sortOrder} />
      {nodes.length > 0 ? (
        nodes.map((node) => <NodeEditor node={node} key={node.id} />)
      ) : (
        <p className="admin-node-empty">尚未创建节点。</p>
      )}
    </div>
  );
}
