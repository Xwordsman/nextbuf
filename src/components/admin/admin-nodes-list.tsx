import { Plus } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AdminNodeFormValue } from "@/components/admin/admin-nodes.client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AdminNodesList({ nodes }: { nodes: AdminNodeFormValue[] }) {
  return (
    <div className="admin-table-scroll">
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
              <TableCell colSpan={6}>
                <div className="admin-table-empty">
                  <span>尚未创建节点。</span>
                  <Button asChild size="sm">
                    <Link href="/admin/nodes/new">
                      <Plus /> 创建首个节点
                    </Link>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            nodes.map((node) => (
              <TableRow key={node.id}>
                <TableCell>
                  <Link
                    className="admin-table-primary admin-node-table-title"
                    href={`/admin/nodes/${node.slug}`}
                  >
                    <span style={{ backgroundColor: node.color }} aria-hidden="true" />
                    <span>
                      {node.name}
                      <small>/{node.slug}</small>
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="neutral">{node.visibility === "public" ? "公开" : "隐藏"}</Badge>
                  {node.archivedAt ? <small>已归档</small> : null}
                </TableCell>
                <TableCell>{node._count.topics}</TableCell>
                <TableCell>{node._count.roleAssignments}</TableCell>
                <TableCell>{node.sortOrder}</TableCell>
                <TableCell>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/nodes/${node.slug}`}>编辑</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
