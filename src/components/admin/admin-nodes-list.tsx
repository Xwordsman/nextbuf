import { Plus } from "lucide-react";
import Link from "next/link";
import type { AdminNodeFormValue } from "@/components/admin/admin-nodes.client";
import { Badge } from "@/components/admin/ui/badge";
import { Button } from "@/components/admin/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/admin/ui/table";

export function AdminNodesList({ nodes }: { nodes: AdminNodeFormValue[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>节点</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>主题</TableHead>
          <TableHead>版主</TableHead>
          <TableHead>排序</TableHead>
          <TableHead>
            <span className="sr-only">操作</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {nodes.length === 0 ? (
          <TableRow>
            <TableCell className="h-32 text-center" colSpan={6}>
              <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                <span>尚未创建节点。</span>
                <Button asChild size="sm">
                  <Link href="/admin/nodes/new">
                    <Plus aria-hidden="true" />
                    创建首个节点
                  </Link>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ) : (
          nodes.map((node) => (
            <TableRow key={node.id}>
              <TableCell className="min-w-48 whitespace-normal">
                <Link
                  className="flex items-center gap-3 font-medium hover:underline"
                  href={`/admin/nodes/${node.slug}`}
                >
                  <span
                    aria-hidden="true"
                    className="size-8 shrink-0 rounded-md"
                    style={{ backgroundColor: node.color }}
                  />
                  <span className="grid gap-0.5">
                    {node.name}
                    <span className="text-xs font-normal text-muted-foreground">/{node.slug}</span>
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{node.visibility === "public" ? "公开" : "隐藏"}</Badge>
                  {node.archivedAt ? <Badge variant="secondary">已归档</Badge> : null}
                </div>
              </TableCell>
              <TableCell>{node._count.topics}</TableCell>
              <TableCell>{node._count.roleAssignments}</TableCell>
              <TableCell>{node.sortOrder}</TableCell>
              <TableCell>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/admin/nodes/${node.slug}`}>编辑</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
