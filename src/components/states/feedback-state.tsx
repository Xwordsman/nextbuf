import Link from "next/link";
import { AlertTriangle, Inbox, LockKeyhole, SearchX, Wrench, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

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
    <main className="feedback-page">
      <section className="feedback-state" aria-labelledby="feedback-title">
        <span className="feedback-icon" aria-hidden="true">
          <Icon />
        </span>
        <h1 id="feedback-title">{title}</h1>
        <p>{description}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {actions ?? (
            <Button asChild>
              <Link href="/">返回首页</Link>
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}
