import { cn } from "@/shared/utils/cn";

export function MarkdownContent({ html, className }: { html: string; className?: string }) {
  return (
    <div className={cn("markdown-body", className)} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
