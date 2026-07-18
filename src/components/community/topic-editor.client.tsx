"use client";

import { LoaderCircle, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownEditor } from "@/components/community/markdown-editor.client";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shadcn/ui/card";
import { Checkbox } from "@/components/shadcn/ui/checkbox";
import { Input } from "@/components/shadcn/ui/input";
import { Label } from "@/components/shadcn/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select";
import { Separator } from "@/components/shadcn/ui/separator";

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
    invalid_topic: "请检查标题、正文长度、链接数量和附件引用。",
    invalid_attachment: "正文包含无效、失败或不属于你的附件。",
    node_unavailable: "该节点不可用或已经归档。",
    topic_rate_limited: "已达到站点当前的每小时主题上限，请稍后再试。",
    topic_posting_disabled: "站点当前已暂停发布新主题。",
    draft_limit_reached: "最多保留 20 个草稿，请先处理已有草稿。",
    forbidden: "你没有执行该操作的权限。",
    invalid_topic_state: "当前主题状态不允许执行该操作。",
    topic_not_found: "主题不存在或已经不可访问。",
  };
  return messages[code] ?? "操作失败，请稍后再试。";
}

export function TopicEditor({ nodes, limits, topic }: TopicEditorProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const autosaveSequence = useRef(0);
  const autosavePromise = useRef<Promise<unknown> | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState(topic?.title ?? "");
  const [body, setBody] = useState(topic?.body ?? "");
  const [nodeSlug, setNodeSlug] = useState(topic?.nodeSlug ?? "");
  const [draftNumber, setDraftNumber] = useState<number | null>(topic?.number ?? null);
  const draftNumberRef = useRef<number | null>(topic?.number ?? null);
  const [status, setStatus] = useState(topic?.status ?? "draft");
  const [autosaveStatus, setAutosaveStatus] = useState(
    topic?.status === "draft" ? "已载入草稿" : "",
  );

  const request = useCallback(
    async (action: string, payload?: Record<string, unknown>, background = false) => {
      if (!background) setPending(action);
      setMessage("");
      const response = await fetch(
        draftNumberRef.current
          ? `/api/community/topics/${draftNumberRef.current}`
          : "/api/community/topics",
        {
          method: draftNumberRef.current ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        },
      ).catch(() => null);
      if (!response) {
        if (!background) setPending("");
        setMessage("网络请求失败，请检查连接后重试。");
        return null;
      }
      const result = (await response.json().catch(() => ({}))) as {
        code?: string;
        number?: number;
        status?: string;
      };
      if (!response.ok) {
        if (!background) setPending("");
        setMessage(errorMessage(result.code ?? "request_failed"));
        return null;
      }
      if (result.number) {
        draftNumberRef.current = result.number;
        setDraftNumber(result.number);
      }
      if (result.status) setStatus(result.status);
      if (!background) setPending("");
      return result;
    },
    [],
  );

  const persistContent = useCallback(
    async (intent: "draft" | "publish" | "save", background = false) => {
      const normalizedTitle = title.trim();
      const normalizedBody = body.trim();
      const requiresPublishRules =
        intent === "publish" || (intent === "save" && status !== "draft");
      if (
        !nodeSlug ||
        normalizedTitle.length < (requiresPublishRules ? limits.publishTitleMin : 1) ||
        normalizedTitle.length > limits.titleMax ||
        normalizedBody.length < (requiresPublishRules ? limits.publishBodyMin : 0) ||
        normalizedBody.length > limits.bodyMax
      ) {
        if (!background) setMessage("请检查标题、正文长度和节点选择。");
        return null;
      }
      const action = intent === "draft" && draftNumberRef.current ? "save" : intent;
      const result = await request(
        action,
        { title: normalizedTitle, body: normalizedBody, nodeSlug },
        background,
      );
      const number = result?.number ?? draftNumberRef.current;
      if (!result || !number) return null;
      if (background) {
        window.history.replaceState(null, "", `/topics/${number}/edit?autosaved=1`);
      } else if (intent === "draft") {
        window.location.assign(`/topics/${number}/edit?created=draft`);
      } else {
        window.location.assign(`/topics/${number}`);
      }
      return result;
    },
    [body, limits, nodeSlug, request, status, title],
  );

  const runExplicitSave = async (intent: "draft" | "publish" | "save") => {
    setPending(intent);
    autosaveSequence.current += 1;
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    await autosavePromise.current;
    const result = await persistContent(intent);
    if (!result) setPending("");
    return result;
  };

  useEffect(() => {
    if (status !== "draft" || !nodeSlug || title.trim().length < 1) return;
    const sequence = ++autosaveSequence.current;
    autosaveTimer.current = window.setTimeout(async () => {
      autosaveTimer.current = null;
      setAutosaveStatus("正在自动保存");
      const operation = persistContent("draft", true);
      autosavePromise.current = operation;
      const result = await operation;
      if (autosavePromise.current === operation) autosavePromise.current = null;
      if (sequence === autosaveSequence.current) {
        setAutosaveStatus(result ? "已自动保存" : "自动保存失败");
      }
    }, 1_500);
    return () => {
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [body, nodeSlug, persistContent, status, title]);

  const saveModeration = async () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    const result = await request("moderate", {
      isPinned: data.get("isPinned") === "on",
      isEssence: data.get("isEssence") === "on",
      isClosed: data.get("isClosed") === "on",
      isHidden: data.get("isHidden") === "on",
    });
    if (result) window.location.reload();
  };

  const changeState = async (action: "delete" | "restore") => {
    const result = await request(action);
    if (!result) return;
    const number = result.number ?? draftNumber;
    window.location.assign(
      action === "delete" ? "/account/topics" : `/topics/${number ?? ""}/edit`,
    );
  };

  if (topic?.status === "deleted") {
    return (
      <Card size="sm" className="mx-auto mt-8 max-w-2xl">
        <CardHeader>
          <CardTitle>
            <h2>主题已删除</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">主题编号、首帖、修订和审计记录仍然保留。</p>
          <Button type="button" onClick={() => changeState("restore")} disabled={Boolean(pending)}>
            {pending === "restore" ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
            恢复主题
          </Button>
          {message ? <p className="text-sm text-destructive">{message}</p> : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <form
      ref={formRef}
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]"
      onSubmit={(event) => event.preventDefault()}
    >
      <Card size="sm" className="gap-0 py-0">
        <CardHeader className="border-b py-3">
          <CardTitle>
            <h2>{topic ? "编辑主题" : "主题内容"}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 py-4">
          <div className="grid gap-2">
            <Label htmlFor="topic-title">标题</Label>
            <Input
              id="topic-title"
              name="title"
              value={title}
              maxLength={limits.titleMax}
              onChange={(event) => {
                setTitle(event.target.value);
                if (status === "draft") setAutosaveStatus("等待自动保存");
              }}
              placeholder="用一句话写清想讨论的问题"
              required
            />
            <p className="text-xs text-muted-foreground">发布时需要 6-120 个字符。</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="topic-node">节点</Label>
            <Select
              value={nodeSlug}
              onValueChange={(value) => {
                setNodeSlug(value);
                if (status === "draft") setAutosaveStatus("等待自动保存");
              }}
            >
              <SelectTrigger id="topic-node" className="w-full">
                <SelectValue placeholder="选择节点" />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((node) => (
                  <SelectItem key={node.slug} value={node.slug}>
                    {node.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="topic-body">正文</Label>
            <MarkdownEditor
              id="topic-body"
              name="body"
              value={body}
              onChange={(value) => {
                setBody(value);
                if (status === "draft") setAutosaveStatus("等待自动保存");
              }}
              maxLength={limits.bodyMax}
              placeholder="补充背景、尝试过的方法和期望得到的帮助"
              disabled={Boolean(pending)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <p>发布时至少 20 个字符，最多 5 个 HTTP(S) 链接。</p>
              {autosaveStatus ? <span aria-live="polite">{autosaveStatus}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!topic || status === "draft" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => runExplicitSave("draft")}
                disabled={Boolean(pending)}
              >
                {pending === "draft" || pending === "save" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Save />
                )}
                保存草稿
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => runExplicitSave("save")}
                disabled={Boolean(pending)}
              >
                {pending === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}
                保存修改
              </Button>
            )}
            {!topic || status === "draft" ? (
              <Button
                type="button"
                onClick={() => runExplicitSave("publish")}
                disabled={Boolean(pending)}
              >
                {pending === "publish" ? <LoaderCircle className="animate-spin" /> : <Send />}
                发布主题
              </Button>
            ) : null}
          </div>
          {message ? (
            <p className="text-sm text-destructive" role="status">
              {message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {topic ? (
        <Card size="sm" className="h-fit gap-0 py-0">
          <CardHeader className="border-b py-3">
            <CardTitle>
              <h2>主题设置</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 py-4">
            {topic.canModerate ? (
              <section className="grid gap-3">
                <h2 className="text-sm font-medium">管理状态</h2>
                <Label className="flex items-center gap-2 font-normal">
                  <Checkbox id="topic-is-pinned" name="isPinned" defaultChecked={topic.isPinned} />
                  置顶
                </Label>
                <Label className="flex items-center gap-2 font-normal">
                  <Checkbox
                    id="topic-is-essence"
                    name="isEssence"
                    defaultChecked={topic.isEssence}
                  />
                  精华
                </Label>
                <Label className="flex items-center gap-2 font-normal">
                  <Checkbox id="topic-is-closed" name="isClosed" defaultChecked={topic.isClosed} />
                  关闭
                </Label>
                <Label className="flex items-center gap-2 font-normal">
                  <Checkbox id="topic-is-hidden" name="isHidden" defaultChecked={topic.isHidden} />
                  隐藏
                </Label>
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
            {topic.canModerate ? <Separator /> : null}
            <section className="grid gap-3">
              <h2 className="text-sm font-medium">删除主题</h2>
              <p className="text-xs leading-5 text-muted-foreground">
                删除不会移除主题编号、首帖、修订、回复或审计关系。
              </p>
              <Button
                type="button"
                variant="destructive"
                onClick={() => changeState("delete")}
                disabled={Boolean(pending)}
              >
                <Trash2 /> 删除主题
              </Button>
            </section>
            <Separator />
            <section className="grid gap-3">
              <h2 className="text-sm font-medium">修订历史</h2>
              <ol className="grid gap-2">
                {topic.revisions.map((revision) => (
                  <li className="grid gap-0.5 text-xs" key={revision.version}>
                    <strong className="font-medium">版本 {revision.version}</strong>
                    <span className="text-muted-foreground">
                      {revision.source} · {new Date(revision.createdAt).toLocaleString("zh-CN")}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </CardContent>
        </Card>
      ) : null}
    </form>
  );
}
