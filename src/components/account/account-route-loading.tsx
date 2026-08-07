import { Card, CardContent } from "@/components/shadcn/ui/card";
import { Skeleton } from "@/components/shadcn/ui/skeleton";

export function AccountRouteLoading() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="account-route-loading">
      <span className="sr-only">正在加载账户设置</span>
      <div className="mb-6 grid gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <Card className="gap-0 py-0" aria-hidden="true">
        <CardContent className="grid gap-5 px-5 py-6 sm:px-6">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="grid gap-2" key={index}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
