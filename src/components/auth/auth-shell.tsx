import Link from "next/link";
import { MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shadcn/ui/card";

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[min(640px,calc(100dvh-var(--header-height)))] w-full max-w-2xl items-start justify-center px-4 py-10 sm:px-6 sm:py-14">
      <Card className="w-full max-w-[32rem] gap-0 py-0 shadow-sm">
        <CardHeader className="gap-4 border-b px-5 py-5 sm:px-6">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2 rounded-md text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="NextBuf 首页"
          >
            <span
              className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
              aria-hidden="true"
            >
              <MessageSquare className="size-4" />
            </span>
            <span>NextBuf</span>
          </Link>
          <div className="grid gap-1">
            <CardTitle className="text-xl font-semibold">
              <h1>{title}</h1>
            </CardTitle>
            <CardDescription className="leading-6">{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-5 py-5 sm:px-6 sm:py-6">{children}</CardContent>
      </Card>
    </main>
  );
}
