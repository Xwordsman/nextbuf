"use client";

import { LoaderCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarkdownEditor } from "@/components/community/markdown-editor.client";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

type ReplyEditorProps = {
  topicNumber: number;
  initialDraft?: {
    body: string;
    quotedPosition: number | null;
    quotedAuthorName: string | null;
  } | null;
  bodyMax: number;
};

type QuoteDetail = { position: number; authorName: string };

function replyError(code?: string): string {
  const messages: Record<string, string> = {
    invalid_post: "回复长度、链接数、提及数或附件引用不符合要求。",
    invalid_attachment: "回复包含无效、失败或不属于你的附件。",
    reply_rate_limited: "已达到站点当前的每小时回复上限，请稍后再试。",
    reply_posting_disabled: "站点当前已暂停发布回复。",
    topic_closed: "主题已经关闭，当前不能回复。",
    forbidden: "你没有回复该主题的权限。",
  };
  return messages[code ?? ""] ?? "回复操作失败，请稍后再试。";
}

function navigateToReply(topicNumber: number, position: number): void {
  const from = Math.floor((position - 2) / 30) * 30 + 2;
  const pagePath = `/topics/${topicNumber}?from=${from}`;
  const hash = `#post-${position}`;
  if (`${window.location.pathname}${window.location.search}` === pagePath) {
    window.location.hash = hash;
    window.location.reload();
    return;
  }
  window.location.assign(`${pagePath}${hash}`);
}

export function ReplyEditor({ topicNumber, initialDraft, bodyMax }: ReplyEditorProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const dirty = useRef(false);
  const saveSequence = useRef(0);
  const autosavePromise = useRef<Promise<void> | null>(null);
  const autosaveTimer = useRef<number | null>(null);
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
  const [saveStatus, setSaveStatus] = useState(initialDraft ? "已载入草稿" : "");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<QuoteDetail>).detail;
      dirty.current = true;
      quoteRef.current = detail;
      setQuote(detail);
      setSaveStatus("等待自动保存");
      sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("nextbuf:quote-reply", listener);
    return () => window.removeEventListener("nextbuf:quote-reply", listener);
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    const sequence = ++saveSequence.current;
    autosaveTimer.current = window.setTimeout(async () => {
      autosaveTimer.current = null;
      setSaveStatus("正在自动保存");
      const operation = (async () => {
        const response = await fetch(`/api/community/topics/${topicNumber}/replies`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body, quotedPosition: quote?.position ?? null }),
        }).catch(() => null);
        if (!response) {
          if (sequence === saveSequence.current) setSaveStatus("自动保存失败");
          return;
        }
        const result = (await response.json().catch(() => ({}))) as {
          code?: string;
          savedAt?: string | null;
        };
        if (sequence === saveSequence.current) {
          setSaveStatus(
            response.ok ? (result.savedAt ? "已自动保存" : "草稿已清除") : "自动保存失败",
          );
        }
      })();
      autosavePromise.current = operation;
      await operation;
      if (autosavePromise.current === operation) autosavePromise.current = null;
    }, 1_500);
    return () => {
      if (autosaveTimer.current !== null) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [body, quote, topicNumber]);

  const publish = async () => {
    setPending(true);
    setMessage("");
    saveSequence.current += 1;
    if (autosaveTimer.current !== null) {
      window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
    await autosavePromise.current;
    const response = await fetch(`/api/community/topics/${topicNumber}/replies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: bodyRef.current,
        quotedPosition: quoteRef.current?.position ?? null,
      }),
    }).catch(() => null);
    if (!response) {
      setMessage("回复发布失败，请检查网络后重试。");
      setPending(false);
      return;
    }
    const result = (await response.json().catch(() => ({}))) as {
      code?: string;
      position?: number;
    };
    if (!response.ok || !result.position) {
      setMessage(replyError(result.code));
      setPending(false);
      return;
    }
    navigateToReply(topicNumber, result.position);
  };

  return (
    <section ref={sectionRef} className="reply-compose" aria-labelledby="reply-compose-title">
      <Panel>
        <div className="reply-compose-head">
          <div>
            <h2 id="reply-compose-title">发表回复</h2>
            {saveStatus ? <span aria-live="polite">{saveStatus}</span> : null}
          </div>
          {quote ? (
            <div className="reply-quote-target">
              <span>
                引用 #{quote.position} · {quote.authorName}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="取消引用"
                onClick={() => {
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
        </div>
        <MarkdownEditor
          id="reply-body"
          name="body"
          value={body}
          onChange={(value) => {
            dirty.current = true;
            bodyRef.current = value;
            setBody(value);
            setSaveStatus("等待自动保存");
          }}
          maxLength={bodyMax}
          placeholder="写下你的回复"
          disabled={pending}
          ariaLabel="回复正文"
        />
        <div className="reply-compose-actions">
          <span>
            {body.length.toLocaleString("zh-CN")} / {bodyMax.toLocaleString("zh-CN")}
          </span>
          <Button type="button" onClick={publish} disabled={pending || body.trim().length < 2}>
            {pending ? <LoaderCircle className="animate-spin" /> : <Send />}
            发布回复
          </Button>
        </div>
        {message ? (
          <p className="settings-message" role="status">
            {message}
          </p>
        ) : null}
      </Panel>
    </section>
  );
}
