"use client";

import { Bold, Code2, Italic, Link2, LoaderCircle, Paperclip, Quote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarkdownContent } from "@/components/community/markdown-content";
import { Button } from "@/components/shadcn/ui/button";
import { Input } from "@/components/shadcn/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shadcn/ui/tabs";
import { Textarea } from "@/components/shadcn/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/ui/tooltip";
import { ATTACHMENT_UPLOAD_TIMEOUT_MS } from "@/shared/community/editor-session";
import { fetchWithTimeout } from "@/shared/http/fetch-with-timeout.client";

type MarkdownEditorProps = {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  onUploadPendingChange?: (pending: boolean) => void;
};

type InsertRule = { before: string; after: string; fallback: string };

const tools: Array<{
  label: string;
  icon: typeof Bold;
  rule: InsertRule;
}> = [
  { label: "加粗", icon: Bold, rule: { before: "**", after: "**", fallback: "加粗文本" } },
  { label: "斜体", icon: Italic, rule: { before: "*", after: "*", fallback: "斜体文本" } },
  { label: "行内代码", icon: Code2, rule: { before: "`", after: "`", fallback: "code" } },
  { label: "引用", icon: Quote, rule: { before: "> ", after: "", fallback: "引用内容" } },
  {
    label: "链接",
    icon: Link2,
    rule: { before: "[", after: "](https://)", fallback: "链接文字" },
  },
];

export function MarkdownEditor({
  id,
  name,
  value,
  onChange,
  maxLength,
  placeholder,
  disabled,
  ariaLabel,
  onUploadPendingChange,
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const mounted = useRef(true);
  const [tab, setTab] = useState("write");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewPending, setPreviewPending] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (tab !== "preview") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (!mounted.current) return;
      setPreviewPending(true);
      const response = await fetch("/api/community/markdown/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: value }),
        signal: controller.signal,
      }).catch(() => null);
      if (controller.signal.aborted || !mounted.current) return;
      if (!response || !response.ok) {
        setMessage("预览暂时不可用。");
      } else {
        const result = (await response.json().catch(() => null)) as unknown;
        if (controller.signal.aborted || !mounted.current) return;
        const html =
          result && typeof result === "object" && !Array.isArray(result)
            ? (result as Record<string, unknown>).html
            : null;
        if (typeof html === "string") {
          setPreviewHtml(html);
          setMessage("");
        } else {
          setMessage("预览暂时不可用。");
        }
      }
      if (!controller.signal.aborted && mounted.current) setPreviewPending(false);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [tab, value]);

  const insert = (rule: InsertRule) => {
    if (!mounted.current) return;
    const textarea = textareaRef.current;
    const currentValue = valueRef.current;
    const start = textarea?.selectionStart ?? currentValue.length;
    const end = textarea?.selectionEnd ?? currentValue.length;
    const selected = currentValue.slice(start, end) || rule.fallback;
    const next = `${currentValue.slice(0, start)}${rule.before}${selected}${rule.after}${currentValue.slice(end)}`;
    if (next.length > maxLength) {
      setMessage("内容长度已达上限，所选内容没有插入编辑器。");
      return;
    }
    valueRef.current = next;
    onChange(next);
    setTab("write");
    const selectionStart = start + rule.before.length;
    const selectionEnd = selectionStart + selected.length;
    window.requestAnimationFrame(() => {
      const currentTextarea = textareaRef.current;
      currentTextarea?.focus();
      currentTextarea?.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const insertAttachment = (markdown: string) => {
    if (!mounted.current) return;
    const textarea = textareaRef.current;
    const currentValue = valueRef.current;
    const position = textarea?.selectionEnd ?? currentValue.length;
    const insertion = `\n${markdown}\n`;
    const next = `${currentValue.slice(0, position)}${insertion}${currentValue.slice(position)}`;
    if (next.length > maxLength) {
      setMessage("附件已上传，但正文长度已达上限，附件链接没有插入编辑器。");
      return;
    }
    valueRef.current = next;
    onChange(next);
    setTab("write");
    window.requestAnimationFrame(() => {
      const currentTextarea = textareaRef.current;
      currentTextarea?.focus();
      currentTextarea?.setSelectionRange(position + insertion.length, position + insertion.length);
    });
  };

  const upload = async (file: File) => {
    if (!mounted.current) return;
    setUploadPending(true);
    onUploadPendingChange?.(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("attachment", file);
      const response = await fetchWithTimeout(
        "/api/community/attachments",
        { method: "POST", body: form },
        ATTACHMENT_UPLOAD_TIMEOUT_MS,
      );
      if (!mounted.current) return;
      if (!response) {
        setMessage("附件上传结果无法确认，正文中未插入附件链接。请检查网络后再决定是否重试。");
        return;
      }
      const result = (await response.json().catch(() => null)) as unknown;
      if (!mounted.current) return;
      const record =
        result && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : null;
      const code = typeof record?.code === "string" ? record.code : undefined;
      const markdown = typeof record?.markdown === "string" ? record.markdown : null;
      if (!response.ok) {
        setMessage(
          code === "attachment_too_large"
            ? "附件超过允许大小。"
            : code === "attachment_rate_limited"
              ? "附件上传过于频繁，请稍后再试。"
              : code === "uploads_disabled"
                ? "站点当前已暂停上传附件。"
                : "附件格式不受支持或上传失败。",
        );
      } else if (!markdown) {
        setMessage("服务器响应不完整，无法确认附件链接，正文没有修改。");
      } else {
        insertAttachment(markdown);
      }
    } catch {
      if (mounted.current) setMessage("附件上传失败，请检查网络后重试。");
    } finally {
      if (mounted.current) {
        setUploadPending(false);
        onUploadPendingChange?.(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    }
  };

  return (
    <Tabs value={tab} onValueChange={setTab} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList variant="line" aria-label="编辑模式">
          <TabsTrigger value="write">编写</TabsTrigger>
          <TabsTrigger value="preview">预览</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-0.5" aria-label="Markdown 工具栏">
          {tools.map(({ label, icon: Icon, rule }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  onClick={() => insert(rule)}
                  disabled={disabled}
                >
                  <Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="上传附件"
                onClick={() => fileRef.current?.click()}
                disabled={disabled || uploadPending}
              >
                {uploadPending ? <LoaderCircle className="animate-spin" /> : <Paperclip />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>上传附件</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <TabsContent value="write" className="m-0">
        <Textarea
          ref={textareaRef}
          id={id}
          name={name}
          value={value}
          maxLength={maxLength}
          onChange={(event) => {
            valueRef.current = event.target.value;
            onChange(event.target.value);
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={ariaLabel}
          className="min-h-64 resize-y font-mono text-sm leading-6"
        />
      </TabsContent>
      <TabsContent value="preview" className="m-0">
        <div className="min-h-64 rounded-lg border bg-muted/20 p-3" aria-live="polite">
          {previewPending ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="animate-spin" /> 正在生成预览
            </span>
          ) : previewHtml ? (
            <MarkdownContent html={previewHtml} />
          ) : (
            <p>尚未填写内容。</p>
          )}
        </div>
      </TabsContent>
      <Input
        ref={fileRef}
        type="file"
        className="sr-only"
        aria-label="选择附件"
        accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,application/zip,.zip"
        disabled={disabled || uploadPending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {message ? (
        <p className="text-sm text-destructive" role="status">
          {message}
        </p>
      ) : null}
    </Tabs>
  );
}
