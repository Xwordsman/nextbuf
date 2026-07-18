"use client";

import { Archive, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/shadcn/ui/button";
import { Input } from "@/components/shadcn/ui/input";
import { Label } from "@/components/shadcn/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select";
import { Switch } from "@/components/shadcn/ui/switch";

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
    <form className="space-y-6" onSubmit={submit}>
      {node ? (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
          <span
            aria-hidden="true"
            className="h-10 w-2 rounded-full"
            style={{ backgroundColor: form.color }}
          />
          <div className="grid gap-0.5">
            <strong className="font-medium">{node.slug}</strong>
            <span className="text-sm text-muted-foreground">
              {node._count.topics} 个主题 · {node._count.roleAssignments} 个版主角色
            </span>
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        {isCreate ? (
          <div className="grid gap-2">
            <Label htmlFor="node-slug">节点标识</Label>
            <Input
              id="node-slug"
              maxLength={64}
              minLength={2}
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
              pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
              required
              value={form.slug}
            />
            <p className="text-xs text-muted-foreground">
              仅允许小写字母、数字和中划线，创建后不可修改。
            </p>
          </div>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="node-name">名称</Label>
          <Input
            id="node-name"
            maxLength={80}
            minLength={2}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
            value={form.name}
          />
        </div>
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="node-description">简介</Label>
          <Input
            id="node-description"
            maxLength={500}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            value={form.description}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="node-color">颜色</Label>
          <div className="flex items-center gap-3">
            <Input
              className="h-8 w-12 p-1"
              id="node-color"
              onChange={(event) => setForm({ ...form, color: event.target.value })}
              type="color"
              value={form.color}
            />
            <span className="text-sm text-muted-foreground">{form.color.toUpperCase()}</span>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="node-icon">图标</Label>
          <Select onValueChange={(icon) => setForm({ ...form, icon })} value={form.icon}>
            <SelectTrigger className="w-full" id="node-icon">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {iconOptions.map((icon) => (
                <SelectItem key={icon} value={icon}>
                  {icon}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="node-sort-order">排序</Label>
          <Input
            id="node-sort-order"
            max={10_000}
            min={-10_000}
            onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })}
            type="number"
            value={form.sortOrder}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="node-visibility">可见性</Label>
          <Select
            onValueChange={(visibility) => setForm({ ...form, visibility })}
            value={form.visibility}
          >
            <SelectTrigger className="w-full" id="node-visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">公开</SelectItem>
              <SelectItem value="hidden">隐藏</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!isCreate ? (
        <div className="flex items-start gap-3 rounded-lg border p-4">
          <Switch
            aria-label="归档节点"
            checked={form.archived}
            onCheckedChange={(archived) => setForm({ ...form, archived })}
          />
          <div className="grid gap-1">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Archive aria-hidden="true" className="size-4" />
              归档节点
            </span>
            <span className="text-sm text-muted-foreground">
              归档保留主题与审计记录，不会删除已有内容。
            </span>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} type="submit">
          {busy ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" />
          ) : (
            <Save aria-hidden="true" />
          )}
          {isCreate ? "创建节点" : "保存更改"}
        </Button>
        {message ? (
          <span className="text-sm text-muted-foreground" role="status">
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
