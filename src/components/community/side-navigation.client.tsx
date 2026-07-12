"use client";

import Link from "next/link";
import {
  Bot,
  Code2,
  Globe2,
  LayoutGrid,
  Network,
  Server,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { CommunityNodeIcon, CommunityNodeView } from "@/modules/community/contracts/home-view";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/shared/utils/cn";

const iconMap: Record<CommunityNodeIcon, LucideIcon> = {
  grid: LayoutGrid,
  bot: Bot,
  code: Code2,
  server: Server,
  globe: Globe2,
  network: Network,
  sparkles: Sparkles,
};

type SideNavigationProps = {
  nodes: CommunityNodeView[];
  activeNode: string;
};

export function SideNavigation({ nodes, activeNode }: SideNavigationProps) {
  return (
    <Panel className="side-navigation" aria-label="社区节点">
      <div className="nav-label">浏览</div>
      <nav className="node-navigation">
        {nodes.map((node) => {
          const Icon = iconMap[node.icon];
          const active = node.id === activeNode;
          return (
            <Link
              key={node.id}
              href={node.id === "all" ? "/" : `/nodes/${node.id}`}
              className={cn("node-navigation-item", active && "is-active")}
              aria-current={active ? "page" : undefined}
            >
              {node.id === "all" ? (
                <Icon aria-hidden="true" />
              ) : (
                <span
                  className="node-dot"
                  style={{ backgroundColor: node.color }}
                  aria-hidden="true"
                />
              )}
              <span>{node.name}</span>
              <span className="node-count">{node.topicCount}</span>
            </Link>
          );
        })}
      </nav>
    </Panel>
  );
}
