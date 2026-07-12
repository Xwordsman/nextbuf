import Link from "next/link";
import { MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { Panel } from "@/components/ui/panel";

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
    <main className="auth-page">
      <Panel className="auth-card">
        <header className="auth-card-head">
          <Link href="/" className="auth-brand" aria-label="NextBuf 首页">
            <span className="brand-mark" aria-hidden="true">
              <MessageSquare />
            </span>
            <strong>NextBuf</strong>
          </Link>
          <div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </header>
        <div className="auth-card-body">{children}</div>
      </Panel>
    </main>
  );
}
