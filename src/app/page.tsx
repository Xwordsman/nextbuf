export default function Home() {
  return (
    <main className="status-page">
      <section className="status-panel" aria-labelledby="status-title">
        <div className="status-heading">
          <p className="eyebrow">当前里程碑</p>
          <h1 id="status-title">NextBuf v0.2.0</h1>
          <p>
            运行时基础已经接通 PostgreSQL、Redis、Outbox 和独立
            Worker。社区功能将按版本计划逐步实现。
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
            <dt>Data</dt>
            <dd>PostgreSQL 18 + Redis 8</dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>AGPLv3 + Attribution</dd>
          </div>
        </dl>

        <div className="status-actions">
          <a href="/health/live">Liveness</a>
          <a href="/api/version">Version API</a>
          <a href="https://github.com/Xwordsman/nextbuf">GitHub</a>
        </div>
      </section>
    </main>
  );
}
