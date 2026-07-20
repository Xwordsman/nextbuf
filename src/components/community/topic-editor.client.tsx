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
import { SerialTaskQueue } from "@/shared/async/serial-task-queue";
import {
  EDITOR_AUTOSAVE_DELAY_MS,
  EDITOR_RECOVERY_ATTEMPTS,
  EDITOR_RECOVERY_RETRY_MS,
  EDITOR_RECOVERY_TIMEOUT_MS,
  EDITOR_WRITE_TIMEOUT_MS,
  MAX_EDITOR_SESSION_REVISION,
  type EditorSession,
} from "@/shared/community/editor-session";
import {
  clearTopicEditorSession,
  readTopicEditorSession,
  writeTopicEditorSession,
} from "@/shared/community/editor-session-history.client";
import { fetchWithTimeout, readJsonResponse } from "@/shared/http/fetch-with-timeout.client";

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
    editorSessionKey: string | null;
    editorSessionRevision: number | null;
    isClosed: boolean;
    isHidden: boolean;
    isPinned: boolean;
    isEssence: boolean;
    canModerate: boolean;
    revisions: Array<{ version: number; source: string; createdAt: string }>;
  };
};

const topicEditorStatuses = new Set(["draft", "published", "closed", "hidden", "deleted"]);

type TopicWriteResult = {
  number: number;
  status: string;
  editorSessionRevision: number | null;
};

function validEditorSessionRevision(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 1 &&
      value <= MAX_EDITOR_SESSION_REVISION)
  );
}

function isTopicWriteResult(value: unknown): value is TopicWriteResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.number === "number" &&
    Number.isSafeInteger(result.number) &&
    result.number >= 1 &&
    typeof result.status === "string" &&
    topicEditorStatuses.has(result.status) &&
    validEditorSessionRevision(result.editorSessionRevision)
  );
}

function responseCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

function errorMessage(code: string) {
  const messages: Record<string, string> = {
    invalid_topic: "请检查标题、正文长度、链接数量和附件引用。",
    invalid_attachment: "正文包含无效、失败或不属于你的附件。",
    node_unavailable: "该节点不可用或已经归档。",
    topic_rate_limited: "已达到站点当前的每小时主题上限，请稍后再试。",
    topic_posting_disabled: "站点当前已暂停发布新主题。",
    draft_limit_reached: "最多保留 20 个草稿，请先处理已有草稿。",
    editor_session_conflict: "编辑内容发生冲突，请刷新页面后确认最新版本。",
    forbidden: "你没有执行该操作的权限。",
    invalid_topic_state: "当前主题状态不允许执行该操作。",
    topic_not_found: "主题不存在或已经不可访问。",
  };
  return messages[code] ?? "操作失败，请稍后再试。";
}

export function TopicEditor({ nodes, limits, topic }: TopicEditorProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const autosaveSequence = useRef(0);
  const autosaveQueue = useRef<SerialTaskQueue | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const explicitWrite = useRef(false);
  const mounted = useRef(true);
  const recoveryPending = useRef(!topic);
  const editorConflict = useRef(false);
  const newTopic = useRef(!topic);
  const editorSession = useRef<EditorSession | null>(
    topic?.editorSessionKey && topic.editorSessionRevision
      ? { key: topic.editorSessionKey, revision: topic.editorSessionRevision }
      : null,
  );
  if (autosaveQueue.current === null) autosaveQueue.current = new SerialTaskQueue();
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState(topic?.title ?? "");
  const titleRef = useRef(topic?.title ?? "");
  const [body, setBody] = useState(topic?.body ?? "");
  const bodyRef = useRef(topic?.body ?? "");
  const [nodeSlug, setNodeSlug] = useState(topic?.nodeSlug ?? "");
  const nodeSlugRef = useRef(topic?.nodeSlug ?? "");
  const [draftNumber, setDraftNumber] = useState<number | null>(topic?.number ?? null);
  const draftNumberRef = useRef<number | null>(topic?.number ?? null);
  const [status, setStatus] = useState(topic?.status ?? "draft");
  const statusRef = useRef(topic?.status ?? "draft");
  const [uploadPending, setUploadPending] = useState(false);
  const uploadPendingRef = useRef(false);
  const [recovering, setRecovering] = useState(!topic);
  const [conflicted, setConflicted] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState(
    topic?.status === "draft" ? "已载入草稿" : "",
  );

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    if (topic) {
      recoveryPending.current = false;
      return () => {
        cancelled = true;
        mounted.current = false;
      };
    }
    const stored = readTopicEditorSession();
    if (!stored) {
      recoveryPending.current = false;
      window.queueMicrotask(() => {
        if (!cancelled) setRecovering(false);
      });
      return () => {
        cancelled = true;
        mounted.current = false;
      };
    }
    editorSession.current = stored;
    void (async () => {
      let networkUnavailable = false;
      for (let attempt = 0; attempt < EDITOR_RECOVERY_ATTEMPTS; attempt += 1) {
        if (cancelled) return;
        const response = await fetchWithTimeout(
          `/api/community/topics/editor-session/${stored.key}`,
          { method: "GET", cache: "no-store" },
          EDITOR_RECOVERY_TIMEOUT_MS,
        );
        if (cancelled) return;
        if (response?.ok) {
          const target = await readJsonResponse<unknown>(response);
          if (cancelled) return;
          if (!isTopicWriteResult(target) || target.editorSessionRevision === null) {
            editorConflict.current = true;
            setConflicted(true);
            setMessage("无法恢复上一次编辑会话，请刷新页面后重试。");
            break;
          }
          if (target.editorSessionRevision && target.editorSessionRevision > stored.revision) {
            editorSession.current = { key: stored.key, revision: target.editorSessionRevision };
          }
          const path =
            target.status === "draft"
              ? `/topics/${target.number}/edit?recovered=1`
              : target.status === "deleted"
                ? "/account/topics"
                : `/topics/${target.number}`;
          if (clearTopicEditorSession(path)) {
            window.location.reload();
          } else {
            window.location.replace(path);
          }
          return;
        }
        if (response && response.status !== 404) {
          editorConflict.current = true;
          setConflicted(true);
          setMessage("无法恢复上一次编辑会话，请刷新页面后重试。");
          break;
        }
        if (!response) networkUnavailable = true;
        if (attempt + 1 < EDITOR_RECOVERY_ATTEMPTS) {
          await new Promise((resolve) => window.setTimeout(resolve, EDITOR_RECOVERY_RETRY_MS));
        }
      }
      if (!cancelled) {
        recoveryPending.current = false;
        setRecovering(false);
        if (networkUnavailable && !editorConflict.current) {
          setMessage("暂时无法确认上一次保存状态；再次提交仍会沿用同一编辑会话。");
        }
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [topic]);

  const request = useCallback(
    async (action: string, payload?: Record<string, unknown>, background = false) => {
      const contentAction = ["autosave", "draft", "save", "publish"].includes(action);
      if (contentAction && (recoveryPending.current || editorConflict.current)) return null;
      if (!background && mounted.current) setPending(action);
      if (!background && mounted.current) setMessage("");
      const number = draftNumberRef.current;
      const creating = number === null;
      let editorPayload: Record<string, unknown> = {};
      if (contentAction) {
        const current = editorSession.current ??
          (newTopic.current ? readTopicEditorSession() : null) ?? {
            key: globalThis.crypto.randomUUID(),
            revision: 0,
          };
        if (current.revision >= MAX_EDITOR_SESSION_REVISION) {
          if (!background && mounted.current) {
            setPending("");
            setMessage("编辑版本已达到上限，请刷新页面后继续。内容尚未发布。");
          }
          return null;
        }
        const next = { key: current.key, revision: current.revision + 1 };
        editorSession.current = next;
        if (creating) writeTopicEditorSession(next);
        editorPayload = {
          editorSessionKey: next.key,
          editorSessionRevision: next.revision,
        };
      }
      const response = await fetchWithTimeout(
        number ? `/api/community/topics/${number}` : "/api/community/topics",
        {
          method: number ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...payload, ...editorPayload }),
        },
        EDITOR_WRITE_TIMEOUT_MS,
      );
      if (!mounted.current) return null;
      if (!response) {
        if (!background && mounted.current) setPending("");
        if (!background && mounted.current) {
          setMessage(
            action === "publish"
              ? "网络请求失败，无法确认主题是否已经发布。请先到“我的主题”检查，避免重复提交。"
              : "网络请求中断，无法确认本次操作是否已经提交。请刷新后检查，再决定是否重试。",
          );
        }
        return null;
      }
      const result = await readJsonResponse<unknown>(response);
      if (!mounted.current) return null;
      if (result === null) {
        if (!background && mounted.current) setPending("");
        if (!background && mounted.current) {
          setMessage(
            response.ok
              ? action === "publish"
                ? "服务器响应不完整，无法确认主题是否已经发布。请先到“我的主题”检查，避免重复提交。"
                : "服务器响应不完整，无法确认本次保存结果，请刷新后检查。"
              : "服务器返回了无法识别的错误响应，请稍后重试。",
          );
        }
        return null;
      }
      if (!response.ok) {
        const code = responseCode(result);
        if (code === "editor_session_conflict" && mounted.current) {
          editorConflict.current = true;
          setConflicted(true);
          if (background) setAutosaveStatus("编辑冲突，请刷新页面");
        }
        if (!background && mounted.current) setPending("");
        if (!background && mounted.current) {
          const base = errorMessage(code ?? "request_failed");
          setMessage(
            action === "publish"
              ? `${base} ${draftNumberRef.current ? "内容仍保留为草稿，尚未发布。" : "主题尚未发布，当前内容仍保留在编辑器中。"}`
              : base,
          );
        }
        return null;
      }
      if (!isTopicWriteResult(result) || (contentAction && result.editorSessionRevision === null)) {
        if (!background && mounted.current) setPending("");
        if (!background && mounted.current) {
          setMessage(
            action === "publish"
              ? "服务器响应不完整，无法确认主题是否已经发布。请先到“我的主题”检查，避免重复提交。"
              : "服务器响应不完整，无法确认本次保存结果，请刷新后检查。",
          );
        }
        return null;
      }
      draftNumberRef.current = result.number;
      if (mounted.current) setDraftNumber(result.number);
      if (mounted.current) {
        statusRef.current = result.status;
        setStatus(result.status);
      }
      if (
        result.editorSessionRevision &&
        editorSession.current &&
        result.editorSessionRevision > editorSession.current.revision
      ) {
        editorSession.current = {
          key: editorSession.current.key,
          revision: result.editorSessionRevision,
        };
      }
      if (!background && mounted.current) setPending("");
      return result;
    },
    [],
  );

  const persistContent = useCallback(
    async (intent: "draft" | "publish" | "save", background = false) => {
      const normalizedTitle = titleRef.current.trim();
      const normalizedBody = bodyRef.current.trim();
      const currentNodeSlug = nodeSlugRef.current;
      const requiresPublishRules =
        intent === "publish" || (intent === "save" && statusRef.current !== "draft");
      const minimumTitleLength = requiresPublishRules ? limits.publishTitleMin : 1;
      const minimumBodyLength = requiresPublishRules ? limits.publishBodyMin : 0;
      if (
        !currentNodeSlug ||
        normalizedTitle.length < minimumTitleLength ||
        normalizedTitle.length > limits.titleMax ||
        normalizedBody.length < minimumBodyLength ||
        normalizedBody.length > limits.bodyMax
      ) {
        if (!background) {
          const base = !currentNodeSlug
            ? "请选择节点。"
            : normalizedTitle.length < minimumTitleLength
              ? `标题至少需要 ${minimumTitleLength} 个字符。`
              : normalizedTitle.length > limits.titleMax
                ? `标题不能超过 ${limits.titleMax} 个字符。`
                : normalizedBody.length < minimumBodyLength
                  ? `正文至少需要 ${minimumBodyLength} 个字符。`
                  : `正文不能超过 ${limits.bodyMax} 个字符。`;
          setMessage(
            intent === "publish"
              ? `${base} ${draftNumberRef.current ? "内容仍保留为草稿，尚未发布。" : "主题尚未发布，当前内容仍保留在编辑器中。"}`
              : base,
          );
        }
        return null;
      }
      const action = intent === "draft" && draftNumberRef.current ? "autosave" : intent;
      const creating = draftNumberRef.current === null;
      const result = await request(
        action,
        { title: normalizedTitle, body: normalizedBody, nodeSlug: currentNodeSlug },
        background,
      );
      const number = result?.number ?? draftNumberRef.current;
      if (!result || !number) return null;
      if (!mounted.current) return result;
      if (creating) {
        const durablePath =
          result.status === "draft"
            ? `/topics/${number}/edit?${background ? "autosaved=1" : "created=draft"}`
            : `/topics/${number}`;
        clearTopicEditorSession(durablePath);
        newTopic.current = false;
      }
      if (!background) {
        window.location.assign(
          intent === "draft" ? `/topics/${number}/edit?created=draft` : `/topics/${number}`,
        );
      }
      return result;
    },
    [limits, request],
  );

  const runExplicitSave = async (intent: "draft" | "publish" | "save") => {
    if (explicitWrite.current) return null;
    if (recoveryPending.current) return null;
    if (editorConflict.current) {
      setMessage("编辑内容已在其他页面发生变化，请刷新后确认最新版本。");
      return null;
    }
    if (uploadPendingRef.current) {
      setMessage("请等待附件上传完成后再提交。");
      return null;
    }
    explicitWrite.current = true;
    setPending(intent);
    autosaveSequence.current += 1;
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    try {
      await autosaveQueue.current?.onIdle();
      if (!mounted.current) return null;
      const result = await persistContent(intent);
      if (result) return result;
    } catch {
      if (mounted.current) setMessage("操作未完成，当前内容仍保留在编辑器中，请重试。");
    }
    if (mounted.current) {
      explicitWrite.current = false;
      setPending("");
    }
    return null;
  };

  useEffect(() => {
    if (
      explicitWrite.current ||
      recoveryPending.current ||
      editorConflict.current ||
      status !== "draft" ||
      !nodeSlug ||
      title.trim().length < 1
    ) {
      return;
    }
    const sequence = ++autosaveSequence.current;
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null;
      void autosaveQueue.current
        ?.run(async () => {
          if (!mounted.current || sequence !== autosaveSequence.current || explicitWrite.current) {
            return;
          }
          if (mounted.current) setAutosaveStatus("正在自动保存");
          const result = await persistContent("draft", true);
          if (mounted.current && sequence === autosaveSequence.current && !explicitWrite.current) {
            setAutosaveStatus(
              result
                ? "已自动保存"
                : editorConflict.current
                  ? "编辑冲突，请刷新页面"
                  : "自动保存未完成或结果未知",
            );
          }
        })
        .catch(() => {
          if (mounted.current && sequence === autosaveSequence.current && !explicitWrite.current) {
            setAutosaveStatus(
              editorConflict.current ? "编辑冲突，请刷新页面" : "自动保存未完成或结果未知",
            );
          }
        });
    }, EDITOR_AUTOSAVE_DELAY_MS);
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
    if (result && mounted.current) window.location.reload();
  };

  const changeState = async (action: "delete" | "restore") => {
    const result = await request(action);
    if (!result || !mounted.current) return;
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
              disabled={Boolean(pending) || recovering || conflicted}
              onChange={(event) => {
                if (explicitWrite.current) return;
                titleRef.current = event.target.value;
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
              disabled={Boolean(pending) || recovering || conflicted}
              onValueChange={(value) => {
                if (explicitWrite.current) return;
                nodeSlugRef.current = value;
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
                if (explicitWrite.current) return;
                bodyRef.current = value;
                setBody(value);
                if (status === "draft") setAutosaveStatus("等待自动保存");
              }}
              maxLength={limits.bodyMax}
              placeholder="补充背景、尝试过的方法和期望得到的帮助"
              disabled={Boolean(pending) || recovering || conflicted}
              onUploadPendingChange={(nextPending) => {
                uploadPendingRef.current = nextPending;
                setUploadPending(nextPending);
              }}
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
                disabled={Boolean(pending) || uploadPending || recovering || conflicted}
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
                disabled={Boolean(pending) || uploadPending || recovering || conflicted}
              >
                {pending === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}
                保存修改
              </Button>
            )}
            {!topic || status === "draft" ? (
              <Button
                type="button"
                onClick={() => runExplicitSave("publish")}
                disabled={Boolean(pending) || uploadPending || recovering || conflicted}
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
