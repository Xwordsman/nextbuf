import type { HTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn("rounded-lg border border-border bg-surface shadow-panel", className)}
      {...props}
    />
  );
}
