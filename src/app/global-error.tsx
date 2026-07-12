"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <main className="status-page">
          <section className="status-panel">
            <div className="status-heading">
              <p className="eyebrow">应用错误</p>
              <h1>NextBuf 暂时无法响应</h1>
              <p>请稍后重试。管理员可以结合服务日志与请求 ID 继续诊断。</p>
            </div>
            <div className="status-actions">
              <button type="button" onClick={reset}>
                重新尝试
              </button>
            </div>
            <footer className="legal-footer">
              Powered by&nbsp;
              <a href="https://github.com/Xwordsman/nextbuf">NextBuf</a>
            </footer>
          </section>
        </main>
      </body>
    </html>
  );
}
