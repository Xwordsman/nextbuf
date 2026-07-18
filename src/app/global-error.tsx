"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardContent } from "@/components/shadcn/ui/card";
import "./globals.css";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-background text-foreground">
        <main className="grid min-h-dvh place-items-center p-4 sm:p-6">
          <Card className="w-full max-w-md gap-0 py-0 shadow-sm">
            <CardContent className="grid justify-items-center gap-5 px-6 py-9 text-center sm:px-8">
              <span
                className="flex size-11 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
                aria-hidden="true"
              >
                <AlertTriangle className="size-5" />
              </span>
              <div className="grid gap-2">
                <h1 className="text-xl font-semibold">NextBuf 暂时无法响应</h1>
                <p className="text-sm leading-6 text-muted-foreground">请稍后重试。</p>
              </div>
              <Button type="button" onClick={reset}>
                重新尝试
              </Button>
              <p className="text-xs text-muted-foreground">
                Powered by{" "}
                <a
                  className="font-medium underline underline-offset-4 hover:text-foreground"
                  href="https://github.com/Xwordsman/nextbuf"
                >
                  NextBuf
                </a>
              </p>
            </CardContent>
          </Card>
        </main>
      </body>
    </html>
  );
}
