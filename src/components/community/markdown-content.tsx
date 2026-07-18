import { cn } from "@/lib/utils";

// Keep the rendered Markdown presentation colocated with the component instead of
// relying on the retired community-specific global stylesheet.
export const markdownContentClassName =
  "min-w-0 break-words text-sm leading-7 text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_h1]:mt-7 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:leading-7 [&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:leading-7 [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:leading-6 [&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-medium [&_h4]:leading-6 [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-primary/80 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:bg-muted/50 [&_blockquote]:px-3 [&_blockquote]:py-2 [&_blockquote]:text-muted-foreground [&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.82em] [&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:bg-foreground [&_pre]:p-3 [&_pre]:text-background [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_th]:border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_td]:border [&_td]:px-2.5 [&_td]:py-2 [&_td]:text-left [&_img]:my-3.5 [&_img]:block [&_img]:h-auto [&_img]:max-h-[720px] [&_img]:max-w-full [&_img]:rounded-lg";

export function MarkdownContent({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn(markdownContentClassName, className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
