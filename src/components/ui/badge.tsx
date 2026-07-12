import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";

const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold leading-none",
  {
    variants: {
      variant: {
        neutral: "border-border bg-muted text-muted-foreground",
        hot: "border-orange-100 bg-orange-50 text-orange-700",
        pinned: "border-blue-100 bg-blue-50 text-blue-700",
        essence: "border-emerald-100 bg-emerald-50 text-emerald-700",
        trust: "border-zinc-200 bg-zinc-100 text-zinc-700",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
