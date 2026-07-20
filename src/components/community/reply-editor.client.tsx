"use client";

import { LoaderCircle, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownEditor } from "@/components/community/markdown-editor.client";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardContent, CardHeader } from "@/components/shadcn/ui/card";
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
  clearReplyEditorSession,
  readReplyEditorSession,
  writeReplyEditorSession,
} from "@/shared/community/editor-session-history.client";
import { postReferenceLabel } from "@/shared/community/reply-floor";
import { fetchWithTimeout, readJsonResponse } from "@/shared/http/fetch-with-timeout.client";

type ReplyEditorProps = {
  topicNumber: number;
  initialDraft?: {
    body: string;
    quotedPosition: number | null;
    quotedAuthorName: string | null;
    editorSessionKey: string | null;
    editorSessionRevision: number | null;
  } | null;
  bodyMax: number;
  canReply: boolean;
};

type QuoteDetail = { position: number; authorName: string };

type ReplyEditorRecoveryTarget =
  | { kind: "post"; position: number; editorSessionRevision: number }
  | { kind: "draft"; bodyPresent: boolean; editorSessionRevision: number }
  | { kind: "superseded"; editorSessionRevision: number };

type ReplyDraftWriteResult = {
  savedAt: string | null;
  editorSessionRevision: number;
};

function validEditorSessionRevision(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_EDITOR_SESSION_REVISION
  );
}

function isReplyEditorRecoveryTarget(value: unknown): value is ReplyEditorRecoveryTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  if (!validEditorSessionRevision(target.editorSessionRevision)) return false;
  if (target.kind === "superseded") return true;
  if (target.kind === "draft") return typeof target.bodyPresent === "boolean";
  return (
    target.kind === "post" &&
    typeof target.position === "number" &&
    Number.isSafeInteger(target.position) &&
    target.position >= 2
  );
}

function isReplyDraftWriteResult(value: unknown): value is ReplyDraftWriteResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    (result.savedAt === null || typeof result.savedAt === "string") &&
    validEditorSessionRevision(result.editorSessionRevision)
  );
}

function responseCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const code = (value as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

function responsePosition(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const position = (value as Record<string, unknown>).position;
  return typeof position === "number" && Number.isSafeInteger(position) && position >= 2
    ? position
    : null;
}

function replyError(code?: string): string {
  const messages: Record<string, string> = {
    invalid_post: "回复长度、链接数、提及数或附件引用不符合要求。",
    invalid_attachment: "回复包含无效、失败或不属于你的附件。",
    reply_rate_limited: "已达到站点当前的每小时回复上限，请稍后再试。",
    reply_posting_disabled: "站点当前已暂停发布回复。",
    topic_closed: "主题已经关闭，当前不能回复。",
    editor_session_conflict: "回复草稿发生冲突，请刷新页面后确认最新内容。",
    editor_session_rate_limited: "回复编辑会话过于频繁，请稍后再试。",
    forbidden: "你没有回复该主题的权限。",
  };
  return messages[code ?? ""] ?? "回复操作失败，请稍后再试。";
}

function replyPath(topicNumber: number, position: number): string {
  const from = Math.floor((position - 2) / 30) * 30 + 2;
  return `/topics/${topicNumber}?from=${from}#post-${position}`;
}

function replySessionResetPath(path: string): string {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("session-reset", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

function navigateToReply(topicNumber: number, position: number): void {
  const path = replyPath(topicNumber, position);
  if (clearReplyEditorSession(path)) {
    window.location.reload();
  } else {
    window.location.replace(replySessionResetPath(path));
  }
}

function resetSupersededReplySession(topicNumber: number): void {
  if (clearReplyEditorSession()) {
    window.location.reload();
  } else {
    window.location.replace(replySessionResetPath(`/topics/${topicNumber}`));
  }
}

export function ReplyEditor({ topicNumber, initialDraft, bodyMax, canReply }: ReplyEditorProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const dirty = useRef(false);
  const saveSequence = useRef(0);
  const autosaveQueue = useRef<SerialTaskQueue | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const explicitWrite = useRef(false);
  const mounted = useRef(true);
  const recoveryPending = useRef(!initialDraft);
  const editorConflict = useRef(false);
  const editorSession = useRef<EditorSession | null>(
    initialDraft?.editorSessionKey && initialDraft.editorSessionRevision
      ? {
          key: initialDraft.editorSessionKey,
          revision: initialDraft.editorSessionRevision,
        }
      : null,
  );
  if (autosaveQueue.current === null) autosaveQueue.current = new SerialTaskQueue();
  const [body, setBody] = useState(initialDraft?.body ?? "");
  const bodyRef = useRef(initialDraft?.body ?? "");
  const [quote, setQuote] = useState<QuoteDetail | null>(
    initialDraft?.quotedPosition
      ? {
          position: initialDraft.quotedPosition,
          authorName: initialDraft.quotedAuthorName ?? "社区成员",
        }
      : null,
  );
  const quoteRef = useRef<QuoteDetail | null>(
    initialDraft?.quotedPosition
      ? {
          position: initialDraft.quotedPosition,
          authorName: initialDraft.quotedAuthorName ?? "社区成员",
        }
      : null,
  );
  const [pending, setPending] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);
  const uploadPendingRef = useRef(false);
  const [recovering, setRecovering] = useState(!initialDraft);
  const [conflicted, setConflicted] = useState(false);
  const [saveStatus, setSaveStatus] = useState(initialDraft ? "已载入草稿" : "");
  const [message, setMessage] = useState("");

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const stored = readReplyEditorSession(topicNumber);
    if (initialDraft?.editorSessionKey && initialDraft.editorSessionRevision) {
      const revision =
        stored?.key === initialDraft.editorSessionKey
          ? Math.max(stored.revision, initialDraft.editorSessionRevision)
          : initialDraft.editorSessionRevision;
      editorSession.current = { key: initialDraft.editorSessionKey, revision };
      writeReplyEditorSession(topicNumber, editorSession.current);
      recoveryPending.current = false;
      return () => {
        cancelled = true;
        mounted.current = false;
      };
    }
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
          `/api/community/topics/${topicNumber}/replies/editor-session/${stored.key}`,
          { method: "GET", cache: "no-store" },
          EDITOR_RECOVERY_TIMEOUT_MS,
        );
        if (cancelled) return;
        if (response?.ok) {
          const target = await readJsonResponse<unknown>(response);
          if (cancelled) return;
          if (!isReplyEditorRecoveryTarget(target)) {
            editorConflict.current = true;
            setConflicted(true);
            setMessage("无法恢复上一次回复会话，请刷新页面后重试。");
            break;
          }
          if (target.editorSessionRevision > stored.revision) {
            editorSession.current = { key: stored.key, revision: target.editorSessionRevision };
            writeReplyEditorSession(topicNumber, editorSession.current);
          }
          if (target.kind === "post") {
            navigateToReply(topicNumber, target.position);
            return;
          }
          if (target.kind === "superseded") {
            resetSupersededReplySession(topicNumber);
            return;
          }
          if (target.bodyPresent) {
            window.location.reload();
            return;
          }
          recoveryPending.current = false;
          setRecovering(false);
          return;
        }
        if (response && response.status !== 404) {
          editorConflict.current = true;
          setConflicted(true);
          setMessage("无法恢复上一次回复会话，请刷新页面后重试。");
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
          setMessage("暂时无法确认上一次回复状态；再次提交仍会沿用同一编辑会话。");
        }
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [initialDraft, topicNumber]);

  useEffect(() => {
    const listener = (event: Event) => {
      if (explicitWrite.current || recoveryPending.current || editorConflict.current) return;
      if (!editorSession.current) {
        editorSession.current = { key: globalThis.crypto.randomUUID(), revision: 0 };
        writeReplyEditorSession(topicNumber, editorSession.current);
      }
      const detail = (event as CustomEvent<QuoteDetail>).detail;
      dirty.current = true;
      quoteRef.current = detail;
      setQuote(detail);
      setSaveStatus("等待自动保存");
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("nextbuf:quote-reply", listener);
    return () => {
      window.removeEventListener("nextbuf:quote-reply", listener);
    };
  }, [topicNumber]);

  const nextEditorSession = useCallback((): EditorSession | null => {
    const current = editorSession.current ??
      readReplyEditorSession(topicNumber) ?? {
        key: globalThis.crypto.randomUUID(),
        revision: 0,
      };
    if (current.revision >= MAX_EDITOR_SESSION_REVISION) return null;
    const next = { key: current.key, revision: current.revision + 1 };
    editorSession.current = next;
    writeReplyEditorSession(topicNumber, next);
    return next;
  }, [topicNumber]);

  useEffect(() => {
    if (
      !dirty.current ||
      explicitWrite.current ||
      recoveryPending.current ||
      editorConflict.current
    ) {
      return;
    }
    const sequence = ++saveSequence.current;
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = null;
      void autosaveQueue.current
        ?.run(async () => {
          if (!mounted.current || sequence !== saveSequence.current || explicitWrite.current)
            return;
          if (mounted.current) setSaveStatus("正在自动保存");
          const session = nextEditorSession();
          if (!session) {
            if (mounted.current) setSaveStatus("编辑版本已达到上限，请刷新页面");
            return;
          }
          const response = await fetchWithTimeout(
            `/api/community/topics/${topicNumber}/replies`,
            {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                body: bodyRef.current,
                quotedPosition: quoteRef.current?.position ?? null,
                editorSessionKey: session.key,
                editorSessionRevision: session.revision,
              }),
            },
            EDITOR_WRITE_TIMEOUT_MS,
          );
          if (!response) {
            if (mounted.current && sequence === saveSequence.current && !explicitWrite.current) {
              setSaveStatus("无法确认自动保存结果");
            }
            return;
          }
          const result = await readJsonResponse<unknown>(response);
          if (!mounted.current || sequence !== saveSequence.current || explicitWrite.current)
            return;
          if (result === null) {
            if (mounted.current && sequence === saveSequence.current && !explicitWrite.current) {
              setSaveStatus(response.ok ? "无法确认自动保存结果" : "自动保存未完成，请稍后重试");
            }
            return;
          }
          if (!response.ok) {
            const code = responseCode(result);
            if (code === "editor_session_conflict") {
              editorConflict.current = true;
              if (mounted.current) {
                setConflicted(true);
                setSaveStatus("编辑冲突，请刷新页面");
              }
              return;
            }
            if (mounted.current && sequence === saveSequence.current && !explicitWrite.current) {
              setSaveStatus("自动保存未完成，请稍后重试");
            }
            return;
          }
          if (!isReplyDraftWriteResult(result)) {
            if (mounted.current && sequence === saveSequence.current && !explicitWrite.current) {
              setSaveStatus("无法确认自动保存结果");
            }
            return;
          }
          if (
            editorSession.current &&
            result.editorSessionRevision > editorSession.current.revision
          ) {
            editorSession.current = {
              key: editorSession.current.key,
              revision: result.editorSessionRevision,
            };
            writeReplyEditorSession(topicNumber, editorSession.current);
          }
          if (mounted.current && sequence === saveSequence.current && !explicitWrite.current) {
            setSaveStatus(result.savedAt ? "已自动保存" : "草稿已清除");
          }
        })
        .catch(() => {
          if (mounted.current && sequence === saveSequence.current && !explicitWrite.current) {
            setSaveStatus("自动保存未完成或结果未知");
          }
        });
    }, EDITOR_AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [body, nextEditorSession, quote, topicNumber]);

  const publish = async () => {
    if (explicitWrite.current) return;
    if (recoveryPending.current) return;
    if (editorConflict.current) {
      setMessage("回复内容已在其他页面发生变化，请刷新后确认最新版本。");
      return;
    }
    if (uploadPendingRef.current) {
      setMessage("请等待附件上传完成后再发布回复。");
      return;
    }
    explicitWrite.current = true;
    setPending(true);
    setMessage("");
    saveSequence.current += 1;
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    try {
      await autosaveQueue.current?.onIdle();
      if (!mounted.current) return;
      const session = nextEditorSession();
      if (!session) {
        if (mounted.current) setMessage("编辑版本已达到上限，请刷新页面后继续。");
        return;
      }
      const response = await fetchWithTimeout(
        `/api/community/topics/${topicNumber}/replies`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: bodyRef.current,
            quotedPosition: quoteRef.current?.position ?? null,
            editorSessionKey: session.key,
            editorSessionRevision: session.revision,
          }),
        },
        EDITOR_WRITE_TIMEOUT_MS,
      );
      if (!mounted.current) return;
      if (!response) {
        if (mounted.current) {
          setMessage("网络请求失败，无法确认回复是否已经发布。请刷新主题后检查，避免重复提交。");
        }
        return;
      }
      const result = await readJsonResponse<unknown>(response);
      if (!mounted.current) return;
      if (result === null) {
        if (mounted.current) {
          setMessage(
            response.ok
              ? "服务器响应不完整，无法确认回复是否已经发布。请刷新主题后检查，避免重复提交。"
              : "服务器返回了无法识别的错误响应，回复操作未完成。",
          );
        }
        return;
      }
      if (!response.ok) {
        const code = responseCode(result);
        if (code === "editor_session_conflict") {
          editorConflict.current = true;
          if (mounted.current) setConflicted(true);
        }
        if (mounted.current) {
          setMessage(`${replyError(code)} 回复尚未发布，当前内容仍保留在编辑器中。`);
        }
        return;
      }
      const position = responsePosition(result);
      if (position === null) {
        if (mounted.current) {
          setMessage(
            "服务器响应不完整，无法确认回复是否已经发布。请刷新主题后检查，避免重复提交。",
          );
        }
        return;
      }
      if (mounted.current) {
        navigateToReply(topicNumber, position);
      }
    } catch {
      if (mounted.current) setMessage("回复操作未完成，当前内容仍保留在编辑器中，请重试。");
    } finally {
      if (mounted.current) {
        explicitWrite.current = false;
        setPending(false);
      }
    }
  };

  const discardDraft = async () => {
    if (explicitWrite.current || recoveryPending.current || editorConflict.current) return;
    explicitWrite.current = true;
    setPending(true);
    setMessage("");
    saveSequence.current += 1;
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    try {
      await autosaveQueue.current?.onIdle();
      if (!mounted.current) return;
      const session = nextEditorSession();
      if (!session) {
        if (mounted.current) setMessage("编辑版本已达到上限，请刷新页面后继续。");
        return;
      }
      const response = await fetchWithTimeout(
        `/api/community/topics/${topicNumber}/replies`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: "",
            quotedPosition: null,
            editorSessionKey: session.key,
            editorSessionRevision: session.revision,
          }),
        },
        EDITOR_WRITE_TIMEOUT_MS,
      );
      if (!mounted.current) return;
      if (!response) {
        if (mounted.current) {
          setMessage("网络请求失败，无法确认草稿是否已删除。请刷新页面后检查。");
        }
        return;
      }
      const result = await readJsonResponse<unknown>(response);
      if (!mounted.current) return;
      if (result === null) {
        if (mounted.current) {
          setMessage(
            response.ok
              ? "服务器响应不完整，无法确认草稿是否已删除。请刷新页面后检查。"
              : "服务器返回了无法识别的错误响应，请稍后重试。",
          );
        }
        return;
      }
      if (!response.ok) {
        const code = responseCode(result);
        if (code === "editor_session_conflict") {
          editorConflict.current = true;
          if (mounted.current) setConflicted(true);
        }
        if (mounted.current) setMessage(replyError(code));
        return;
      }
      if (!isReplyDraftWriteResult(result) || result.savedAt !== null) {
        if (mounted.current) {
          setMessage("服务器响应不完整，无法确认草稿是否已删除。请刷新页面后检查。");
        }
        return;
      }
      if (clearReplyEditorSession()) {
        window.location.reload();
      } else {
        window.location.replace(replySessionResetPath(`/topics/${topicNumber}`));
      }
    } catch {
      if (mounted.current) setMessage("无法确认草稿是否已删除。请刷新页面后检查。");
    } finally {
      if (mounted.current) {
        explicitWrite.current = false;
        setPending(false);
      }
    }
  };

  if (!canReply && initialDraft) {
    return (
      <section ref={sectionRef} className="mt-4" aria-labelledby="reply-draft-title">
        <Card size="sm">
          <CardHeader>
            <h2 id="reply-draft-title">已保存的回复草稿</h2>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              当前不能继续回复，但你仍可删除自己的草稿及其附件引用。
            </p>
            <div>
              <Button
                type="button"
                variant="destructive"
                onClick={discardDraft}
                disabled={pending || recovering || conflicted}
              >
                {pending ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                删除回复草稿
              </Button>
            </div>
            {message ? (
              <p className="text-sm text-destructive" role="status">
                {message}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className="mt-4" aria-labelledby="reply-compose-title">
      <Card size="sm">
        <CardHeader className="border-b">
          <div>
            <h2 id="reply-compose-title">发表回复</h2>
            {saveStatus ? (
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {saveStatus}
              </span>
            ) : null}
          </div>
          {quote ? (
            <div className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              <span>
                引用 {postReferenceLabel(quote.position)} · {quote.authorName}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="取消引用"
                disabled={pending || recovering || conflicted}
                onClick={() => {
                  if (explicitWrite.current) return;
                  dirty.current = true;
                  quoteRef.current = null;
                  setQuote(null);
                  setSaveStatus("等待自动保存");
                }}
              >
                <X />
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-3">
          <MarkdownEditor
            id="reply-body"
            name="body"
            value={body}
            onChange={(value) => {
              if (explicitWrite.current) return;
              if (!editorSession.current) {
                editorSession.current = { key: globalThis.crypto.randomUUID(), revision: 0 };
                writeReplyEditorSession(topicNumber, editorSession.current);
              }
              dirty.current = true;
              bodyRef.current = value;
              setBody(value);
              setSaveStatus("等待自动保存");
            }}
            maxLength={bodyMax}
            placeholder="写下你的回复"
            disabled={pending || recovering || conflicted}
            onUploadPendingChange={(nextPending) => {
              uploadPendingRef.current = nextPending;
              setUploadPending(nextPending);
            }}
            ariaLabel="回复正文"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {body.length.toLocaleString("zh-CN")} / {bodyMax.toLocaleString("zh-CN")}
            </span>
            <Button
              type="button"
              onClick={publish}
              disabled={
                pending || uploadPending || recovering || conflicted || body.trim().length < 2
              }
            >
              {pending ? <LoaderCircle className="animate-spin" /> : <Send />}
              发布回复
            </Button>
          </div>
          {message ? (
            <p className="text-sm text-destructive" role="status">
              {message}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
