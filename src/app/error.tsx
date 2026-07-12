"use client";

import Link from "next/link";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="status-page">
      <section className="status-panel">
        <div className="status-heading">
          <p className="eyebrow">请求失败</p>
          <h1>页面暂时无法加载</h1>
          <p>错误已经被隔离。可以重试当前操作，持续失败时请记录请求时间。</p>
        </div>
        <div className="status-actions">
          <button type="button" onClick={reset}>
            重新尝试
          </button>
          <Link href="/">返回首页</Link>
        </div>
      </section>
    </main>
  );
}
