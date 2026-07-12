"use client";

import Link from "next/link";
import { FeedbackState } from "@/components/states/feedback-state";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <FeedbackState
      kind="error"
      title="页面暂时无法加载"
      description="请求没有正常完成，可以重试当前操作。"
      actions={
        <>
          <Button type="button" onClick={reset}>
            重新尝试
          </Button>
          <Button asChild variant="outline">
            <Link href="/">返回首页</Link>
          </Button>
        </>
      }
    />
  );
}
