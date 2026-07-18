import { Skeleton } from "@/components/shadcn/ui/skeleton";

export default function Loading() {
  return (
    <main
      className="mx-auto grid w-full max-w-[var(--layout-max)] grid-cols-[var(--left-column)_minmax(0,1fr)_var(--right-column)] gap-[var(--layout-gap)] p-[18px] max-[1100px]:grid-cols-[var(--left-column)_minmax(0,1fr)] max-[860px]:grid-cols-1 max-[860px]:p-3"
      aria-label="正在加载"
    >
      <Skeleton className="min-h-[340px] rounded-xl" />
      <Skeleton className="min-h-[340px] rounded-xl" />
      <Skeleton className="min-h-[340px] rounded-xl max-[1100px]:hidden" />
    </main>
  );
}
