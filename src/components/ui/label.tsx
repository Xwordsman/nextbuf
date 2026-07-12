"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/shared/utils/cn";

export function Label({ className, ...props }: LabelPrimitive.LabelProps) {
  return (
    <LabelPrimitive.Root
      className={cn("text-sm font-medium leading-none text-foreground", className)}
      {...props}
    />
  );
}
