"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "#f4f4f5", color: "#09090b", fontFamily: "system-ui" }}>
        <main
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            padding: 24,
            textAlign: "center",
          }}
        >
          <section>
            <h1 style={{ margin: "0 0 10px", fontSize: 24 }}>NextBuf 暂时无法响应</h1>
            <p style={{ margin: "0 0 20px", color: "#71717a" }}>请稍后重试。</p>
            <button
              type="button"
              onClick={reset}
              style={{
                height: 36,
                padding: "0 14px",
                border: 0,
                borderRadius: 6,
                background: "#18181b",
                color: "#ffffff",
                fontWeight: 600,
              }}
            >
              重新尝试
            </button>
            <p style={{ marginTop: 28, color: "#71717a", fontSize: 12 }}>
              Powered by <a href="https://github.com/Xwordsman/nextbuf">NextBuf</a>
            </p>
          </section>
        </main>
      </body>
    </html>
  );
}
