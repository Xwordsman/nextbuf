"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
          <option value="bot">bot</option>
          <option value="code">code</option>
          <option value="server">server</option>
          <option value="globe">globe</option>
          <option value="network">network</option>
          <option value="sparkles">sparkles</option>
          <option value="grid">grid</option>
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
  return (
    <div className="admin-node-list">
      {nodes.map((node) => (
        <NodeEditor node={node} key={node.id} />
      ))}
    </div>
  );
}
