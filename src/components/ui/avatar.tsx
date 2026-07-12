"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "@/shared/utils/cn";

export function Avatar({ className, ...props }: AvatarPrimitive.AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex size-9 shrink-0 overflow-hidden rounded-full border border-border bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function AvatarImage({ className, ...props }: AvatarPrimitive.AvatarImageProps) {
  return <AvatarPrimitive.Image className={cn("size-full object-cover", className)} {...props} />;
}

export function AvatarFallback({ className, ...props }: AvatarPrimitive.AvatarFallbackProps) {
  return (
    <AvatarPrimitive.Fallback
      className={cn(
        "grid size-full place-items-center bg-avatar text-xs font-semibold text-avatar-foreground",
        className,
      )}
      {...props}
    />
  );
}
