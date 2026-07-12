import Link from "next/link";
import { Archive, ArrowRight } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { listPublicNodes } from "@/modules/community/queries.server";

export const metadata = { title: "社区节点" };

export default async function NodesPage() {
  const nodes = await listPublicNodes();
  return (
    <main className="nodes-page">
      <header className="content-page-head">
        <h1>社区节点</h1>
        <p>节点是主题的主要分类，归档节点保留历史内容但不能继续发布。</p>
      </header>
      <div className="node-directory">
        {nodes.map((node) => (
          <Panel className="node-directory-item" key={node.id}>
            <span className="node-directory-color" style={{ backgroundColor: node.color }} />
            <div>
              <div className="node-directory-title">
                <h2>{node.name}</h2>
                {node.archivedAt ? (
                  <span>
                    <Archive /> 已归档
                  </span>
                ) : null}
              </div>
              <p>{node.description}</p>
              <small>{node._count.topics} 个公开主题</small>
            </div>
            <Link href={`/nodes/${node.slug}`} aria-label={`浏览${node.name}`}>
              <ArrowRight />
            </Link>
          </Panel>
        ))}
      </div>
    </main>
  );
}
