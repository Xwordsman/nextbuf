import Link from "next/link";
import { Archive, ArrowRight } from "lucide-react";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardContent } from "@/components/shadcn/ui/card";
import { listPublicNodes } from "@/modules/community/queries.server";

export const metadata = { title: "社区节点" };

export default async function NodesPage() {
  const nodes = await listPublicNodes();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 grid gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">社区节点</h1>
        <p className="text-sm text-muted-foreground">
          节点是主题的主要分类，归档节点保留历史内容但不能继续发布。
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        {nodes.map((node) => (
          <Card size="sm" className="py-0 transition-shadow hover:shadow-sm" key={node.id}>
            <CardContent className="flex min-h-30 items-center gap-3 py-4">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: node.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{node.name}</h2>
                  {node.archivedAt ? (
                    <Badge variant="outline" className="rounded-md">
                      <Archive />
                      已归档
                    </Badge>
                  ) : null}
                </div>
                <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                  {node.description}
                </p>
                <small className="mt-2 block text-xs text-muted-foreground">
                  {node._count.topics} 个公开主题
                </small>
              </div>
              <Button asChild variant="ghost" size="icon" aria-label={`浏览${node.name}`}>
                <Link href={`/nodes/${node.slug}`}>
                  <ArrowRight />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
