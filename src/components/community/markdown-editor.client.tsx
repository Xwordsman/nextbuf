"use client";

import { Bold, Code2, Italic, Link2, LoaderCircle, Paperclip, Quote } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/shadcn/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shadcn/ui/tabs";
import { Textarea } from "@/components/shadcn/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/ui/tooltip";

type MarkdownEditorProps = {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
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
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const [tab, setTab] = useState("write");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewPending, setPreviewPending] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (tab !== "preview") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPreviewPending(true);
      const response = await fetch("/api/community/markdown/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: value }),
        signal: controller.signal,
      }).catch(() => null);
      if (!response || !response.ok) {
        if (!controller.signal.aborted) setMessage("预览暂时不可用。");
      } else {
        const result = (await response.json()) as { html: string };
        setPreviewHtml(result.html);
        setMessage("");
      }
      if (!controller.signal.aborted) setPreviewPending(false);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [tab, value]);

  const insert = (rule: InsertRule) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentValue = valueRef.current;
    const selected = currentValue.slice(start, end) || rule.fallback;
    const next = `${currentValue.slice(0, start)}${rule.before}${selected}${rule.after}${currentValue.slice(end)}`;
    if (next.length > maxLength) return;
    onChange(next);
    const selectionStart = start + rule.before.length;
    const selectionEnd = selectionStart + selected.length;
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const upload = async (file: File) => {
    setUploadPending(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("attachment", file);
      const response = await fetch("/api/community/attachments", { method: "POST", body: form });
      const result = (await response.json().catch(() => ({}))) as {
        code?: string;
        markdown?: string;
      };
      if (!response.ok || !result.markdown) {
        setMessage(
          result.code === "attachment_too_large"
            ? "附件超过允许大小。"
            : result.code === "attachment_rate_limited"
              ? "附件上传过于频繁，请稍后再试。"
              : result.code === "uploads_disabled"
                ? "站点当前已暂停上传附件。"
                : "附件格式不受支持或上传失败。",
        );
      } else {
        insert({ before: "\n", after: "\n", fallback: result.markdown });
      }
    } catch {
      setMessage("附件上传失败，请检查网络后重试。");
    } finally {
      setUploadPending(false);
      if (fileRef.current) fileRef.current.value = "";
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
          onChange={(event) => onChange(event.target.value)}
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
            <div
              className="markdown-body break-words"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <p>尚未填写内容。</p>
          )}
        </div>
      </TabsContent>
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        aria-label="选择附件"
        accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,application/zip,.zip"
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
