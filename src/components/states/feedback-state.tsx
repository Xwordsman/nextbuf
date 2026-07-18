import Link from "next/link";
import { AlertTriangle, Inbox, LockKeyhole, SearchX, Wrench, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardContent } from "@/components/shadcn/ui/card";

const icons = {
  error: AlertTriangle,
  empty: Inbox,
  notFound: SearchX,
  unauthorized: LockKeyhole,
  maintenance: Wrench,
} satisfies Record<string, LucideIcon>;

type FeedbackStateProps = {
  kind: keyof typeof icons;
  title: string;
  description: string;
  actions?: ReactNode;
};

export function FeedbackState({ kind, title, description, actions }: FeedbackStateProps) {
  const Icon = icons[kind];
  return (
    <main className="mx-auto grid min-h-[56vh] w-full max-w-2xl place-items-center px-4 py-12 sm:px-6">
      <Card size="sm" className="w-full max-w-lg gap-0 py-0 shadow-sm">
        <CardContent className="px-6 py-9 sm:px-9 sm:py-10">
          <section
            className="grid justify-items-center gap-4 text-center"
            aria-labelledby="feedback-title"
          >
            <span
              className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              aria-hidden="true"
            >
              <Icon className="size-5" />
            </span>
            <div className="grid gap-2">
              <h1 id="feedback-title" className="text-xl font-semibold">
                {title}
              </h1>
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {actions ?? (
                <Button asChild>
                  <Link href="/">返回首页</Link>
                </Button>
              )}
            </div>
          </section>
        </CardContent>
      </Card>
    </main>
  );
}
