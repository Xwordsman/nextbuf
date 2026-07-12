"use client";

import { Eye, LoaderCircle, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/ui/panel";
import { Textarea } from "@/components/ui/textarea";

type TopicEditorProps = {
  nodes: Array<{ slug: string; name: string }>;
  limits: {
    titleMax: number;
    publishTitleMin: number;
    bodyMax: number;
    publishBodyMin: number;
  };
  topic?: {
    number: number;
    title: string;
    body: string;
    nodeSlug: string;
    status: string;
    isClosed: boolean;
    isHidden: boolean;
    isPinned: boolean;
    isEssence: boolean;
    canModerate: boolean;
    revisions: Array<{ version: number; source: string; createdAt: string }>;
  };
};

function errorMessage(code: string) {
  const messages: Record<string, string> = {
    invalid_topic: "请检查标题、正文长度和链接数量。",
    node_unavailable: "该节点不可用或已经归档。",
    topic_rate_limited: "一小时内最多发布 3 个主题，请稍后再试。",
    draft_limit_reached: "最多保留 20 个草稿，请先处理已有草稿。",
    forbidden: "你没有执行该操作的权限。",
    invalid_topic_state: "当前主题状态不允许执行该操作。",
    topic_not_found: "主题不存在或已经不可访问。",
  };
  return messages[code] ?? "操作失败，请稍后再试。";
}

export function TopicEditor({ nodes, limits, topic }: TopicEditorProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(false);
  const [previewTitle, setPreviewTitle] = useState(topic?.title ?? "");
  const [previewBody, setPreviewBody] = useState(topic?.body ?? "");

  const request = async (action: string, body?: Record<string, unknown>) => {
    setPending(action);
    setMessage("");
    const response = await fetch(
      topic ? `/api/community/topics/${topic.number}` : "/api/community/topics",
      {
        method: topic ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      },
    );
    const result = (await response.json().catch(() => ({}))) as {
      code?: string;
      number?: number;
      status?: string;
    };
    if (!response.ok) {
      setPending("");
      setMessage(errorMessage(result.code ?? "request_failed"));
      return;
    }
    const number = result.number ?? topic?.number;
    if (action === "delete") window.location.assign("/account/topics");
    else if (action === "restore") window.location.assign(`/topics/${number}/edit`);
    else if (action === "draft") window.location.assign(`/topics/${number}/edit?created=draft`);
    else if (action === "moderate") window.location.reload();
    else window.location.assign(`/topics/${number}`);
  };

  const saveContent = async (action: "draft" | "publish" | "save") => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const body = String(data.get("body") ?? "").trim();
    const nodeSlug = String(data.get("nodeSlug") ?? "");
    const requiresPublishRules =
      action === "publish" || (action === "save" && topic?.status !== "draft");
    if (
      !nodeSlug ||
      title.length < (requiresPublishRules ? limits.publishTitleMin : 1) ||
      title.length > limits.titleMax ||
      body.length < (requiresPublishRules ? limits.publishBodyMin : 0) ||
      body.length > limits.bodyMax
    ) {
      setMessage("请检查标题、正文长度和节点选择。");
      return;
    }
    await request(action, { title, body, nodeSlug });
  };

  const saveModeration = async () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    await request("moderate", {
      isPinned: data.get("isPinned") === "on",
      isEssence: data.get("isEssence") === "on",
      isClosed: data.get("isClosed") === "on",
      isHidden: data.get("isHidden") === "on",
    });
  };

  if (topic?.status === "deleted") {
    return (
      <Panel className="topic-state-panel">
        <h2>主题已删除</h2>
        <p>主题编号、首帖、修订和审计记录仍然保留。</p>
        <Button type="button" onClick={() => request("restore")} disabled={Boolean(pending)}>
          {pending === "restore" ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
          恢复主题
        </Button>
        {message ? <p className="field-error">{message}</p> : null}
      </Panel>
    );
  }

  return (
    <form
      ref={formRef}
      className="topic-editor-layout"
      onSubmit={(event) => event.preventDefault()}
    >
      <Panel className="topic-editor-panel">
        <div className="form-field">
          <Label htmlFor="topic-title">标题</Label>
          <Input
            id="topic-title"
            name="title"
            defaultValue={topic?.title}
            maxLength={limits.titleMax}
            onChange={(event) => setPreviewTitle(event.target.value)}
            placeholder="用一句话写清想讨论的问题"
            required
          />
          <p className="field-hint">发布时需要 6-120 个字符。</p>
        </div>
        <div className="form-field">
          <Label htmlFor="topic-node">节点</Label>
          <select
            id="topic-node"
            name="nodeSlug"
            defaultValue={topic?.nodeSlug ?? ""}
            className="select-control"
            required
          >
            <option value="" disabled>
              选择节点
            </option>
            {nodes.map((node) => (
              <option key={node.slug} value={node.slug}>
                {node.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <Label htmlFor="topic-body">正文</Label>
          <Textarea
            id="topic-body"
            name="body"
            defaultValue={topic?.body}
            maxLength={limits.bodyMax}
            onChange={(event) => setPreviewBody(event.target.value)}
            placeholder="补充背景、尝试过的方法和期望得到的帮助"
          />
          <p className="field-hint">发布时至少 20 个字符，最多 5 个 HTTP(S) 链接。</p>
        </div>
        <div className="topic-editor-actions">
          <Button type="button" variant="outline" onClick={() => setPreview(!preview)}>
            <Eye /> {preview ? "关闭预览" : "预览"}
          </Button>
          {!topic ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => saveContent("draft")}
              disabled={Boolean(pending)}
            >
              {pending === "draft" ? <LoaderCircle className="animate-spin" /> : <Save />} 保存草稿
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => saveContent("save")}
              disabled={Boolean(pending)}
            >
              {pending === "save" ? <LoaderCircle className="animate-spin" /> : <Save />} 保存修改
            </Button>
          )}
          {!topic || topic.status === "draft" ? (
            <Button
              type="button"
              onClick={() => saveContent("publish")}
              disabled={Boolean(pending)}
            >
              {pending === "publish" ? <LoaderCircle className="animate-spin" /> : <Send />}{" "}
              发布主题
            </Button>
          ) : null}
        </div>
        {message ? (
          <p className="settings-message" role="status">
            {message}
          </p>
        ) : null}
      </Panel>

      {preview ? (
        <Panel className="topic-preview" aria-live="polite">
          <span>正文预览</span>
          <h2>{previewTitle || "未填写标题"}</h2>
          <div>{previewBody || "未填写正文"}</div>
        </Panel>
      ) : null}

      {topic ? (
        <Panel className="topic-editor-secondary">
          {topic.canModerate ? (
            <section className="topic-moderation-controls">
              <h2>管理状态</h2>
              <label>
                <input name="isPinned" type="checkbox" defaultChecked={topic.isPinned} /> 置顶
              </label>
              <label>
                <input name="isEssence" type="checkbox" defaultChecked={topic.isEssence} /> 精华
              </label>
              <label>
                <input name="isClosed" type="checkbox" defaultChecked={topic.isClosed} /> 关闭
              </label>
              <label>
                <input name="isHidden" type="checkbox" defaultChecked={topic.isHidden} /> 隐藏
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={saveModeration}
                disabled={Boolean(pending)}
              >
                <Save /> 保存管理状态
              </Button>
            </section>
          ) : null}
          <section className="topic-danger-zone">
            <h2>删除主题</h2>
            <p>删除不会移除主题编号、首帖、修订或审计关系，可以从“我的主题”恢复。</p>
            <Button
              type="button"
              variant="danger"
              onClick={() => request("delete")}
              disabled={Boolean(pending)}
            >
              <Trash2 /> 删除主题
            </Button>
          </section>
          <section className="topic-revision-history">
            <h2>修订历史</h2>
            <ol>
              {topic.revisions.map((revision) => (
                <li key={revision.version}>
                  <strong>版本 {revision.version}</strong>
                  <span>
                    {revision.source} · {new Date(revision.createdAt).toLocaleString("zh-CN")}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </Panel>
      ) : null}
    </form>
  );
}
