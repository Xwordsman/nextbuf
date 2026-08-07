import { Card, CardContent, CardHeader } from "@/components/shadcn/ui/card";
import { Skeleton } from "@/components/shadcn/ui/skeleton";

function RailCard({ rows = 4 }: { rows?: number }) {
  return (
    <Card size="sm" className="gap-3">
      <CardHeader className="border-b">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent className="grid gap-3">
        {Array.from({ length: rows }, (_, index) => (
          <div className="flex items-center gap-2" key={index}>
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <Skeleton className="h-3 flex-1" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function CommunityTopicRouteLoading() {
  return (
    <main
      className="mx-auto grid w-full max-w-[var(--layout-max)] grid-cols-[var(--left-column)_minmax(0,1fr)_var(--right-column)] items-start gap-[var(--layout-gap)] p-[18px] max-[1100px]:grid-cols-[var(--left-column)_minmax(0,1fr)] max-[860px]:grid-cols-1 max-[860px]:p-3"
      aria-busy="true"
      aria-live="polite"
      data-testid="topic-route-loading"
    >
      <span className="sr-only">正在加载主题内容</span>
      <aside className="min-w-0 max-[860px]:hidden" aria-hidden="true">
        <RailCard rows={6} />
      </aside>

      <section className="grid min-w-0 gap-4" aria-hidden="true">
        <Card size="sm" className="gap-0 py-0">
          <CardContent className="grid gap-5 py-5">
            <div className="grid gap-3">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-7 w-4/5" />
              <Skeleton className="h-3 w-56" />
            </div>
            <div className="border-t pt-5">
              <div className="grid gap-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          </CardContent>
        </Card>
        {Array.from({ length: 2 }, (_, index) => (
          <Card size="sm" className="gap-0 py-0" key={index}>
            <CardContent className="grid grid-cols-[40px_minmax(0,1fr)] gap-3 py-4">
              <Skeleton className="size-10 rounded-full" />
              <div className="grid gap-3">
                <div className="flex justify-between gap-4">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-8" />
                </div>
                <Skeleton className="h-4 w-5/6" />
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <aside className="grid min-w-0 gap-3 max-[1100px]:hidden" aria-hidden="true">
        <RailCard rows={2} />
        <RailCard rows={3} />
      </aside>
    </main>
  );
}
