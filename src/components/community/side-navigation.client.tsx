"use client";

import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import type { CommunityNodeView } from "@/modules/community/contracts/home-view";
import { Badge } from "@/components/shadcn/ui/badge";
import { Button } from "@/components/shadcn/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/shadcn/ui/card";

type SideNavigationProps = { nodes: CommunityNodeView[]; activeNode: string };

export function SideNavigation({ nodes, activeNode }: SideNavigationProps) {
  return (
    <Card
      size="sm"
      className="sticky top-[calc(var(--header-height)+18px)] gap-1 overflow-visible py-2 max-[860px]:static max-[860px]:overflow-hidden"
    >
      <CardHeader className="px-3 py-1 max-[860px]:hidden">
        <CardTitle>
          <h2 className="text-xs font-semibold text-muted-foreground">浏览节点</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 max-[860px]:overflow-x-auto">
        <nav aria-label="社区节点">
          <div className="grid gap-0.5 max-[860px]:flex max-[860px]:w-max max-[860px]:min-w-full max-[860px]:gap-1">
            {nodes.map((node) => {
              const active = node.id === activeNode;
              return (
                <Button
                  asChild
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 w-full justify-start px-2.5 text-[13px] max-[860px]:w-auto max-[860px]:shrink-0"
                  key={node.id}
                >
                  <Link
                    href={node.id === "all" ? "/" : `/nodes/${node.id}`}
                    aria-current={active ? "page" : undefined}
                  >
                    {node.id === "all" ? (
                      <LayoutGrid data-icon="inline-start" aria-hidden="true" />
                    ) : (
                      <span
                        className="mx-1 size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: node.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span>{node.name}</span>
                    <Badge
                      variant="outline"
                      className="ml-auto h-5 min-w-6 rounded-md px-1.5 text-[10px] tabular-nums"
                    >
                      {node.topicCount}
                    </Badge>
                  </Link>
                </Button>
              );
            })}
          </div>
        </nav>
      </CardContent>
    </Card>
  );
}
