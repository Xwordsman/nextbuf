import Link from "next/link";

export default function NotFound() {
  return (
    <main className="status-page">
      <section className="status-panel">
        <div className="status-heading">
          <p className="eyebrow">404</p>
          <h1>页面不存在</h1>
          <p>该地址可能已经改变，或者内容尚未在当前里程碑实现。</p>
        </div>
        <div className="status-actions">
          <Link href="/">返回首页</Link>
        </div>
      </section>
    </main>
  );
}
