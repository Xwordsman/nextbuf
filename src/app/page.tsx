export default function Home() {
  return (
    <main className="status-page">
      <section className="status-panel" aria-labelledby="status-title">
        <div className="status-heading">
          <p className="eyebrow">当前里程碑</p>
          <h1 id="status-title">NextBuf v0.1.0</h1>
          <p>
            项目骨架已经启动。当前阶段只建立工程、质量和运行边界，社区功能将按版本计划逐步实现。
          </p>
        </div>

        <dl className="status-grid">
          <div>
            <dt>Web</dt>
            <dd>Next.js 16.2.10</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>Node.js 24 LTS</dd>
          </div>
          <div>
            <dt>Package manager</dt>
            <dd>pnpm 11</dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>AGPLv3 + Attribution</dd>
          </div>
        </dl>

        <div className="status-actions">
          <a href="/api/health/live">Liveness</a>
          <a href="/api/version">Version API</a>
          <a href="https://github.com/Xwordsman/nextbuf">GitHub</a>
        </div>
      </section>
    </main>
  );
}
