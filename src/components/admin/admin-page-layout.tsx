import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/shadcn/ui/button";
import { cn } from "@/lib/utils";

export function AdminPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-6", className)}>{children}</div>;
}

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AdminPagination({
  previousHref,
  nextHref,
}: {
  previousHref?: string;
  nextHref?: string;
}) {
  if (!previousHref && !nextHref) return null;

  return (
    <nav aria-label="分页" className="flex items-center justify-between gap-3">
      <div>
        {previousHref ? (
          <Button asChild size="sm" variant="outline">
            <Link href={previousHref}>
              <ChevronLeft aria-hidden="true" />
              上一页
            </Link>
          </Button>
        ) : null}
      </div>
      <div>
        {nextHref ? (
          <Button asChild size="sm" variant="outline">
            <Link href={nextHref}>
              下一页
              <ChevronRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </div>
    </nav>
  );
}
