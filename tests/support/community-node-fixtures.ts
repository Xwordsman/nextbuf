import { getPrismaClient } from "@/infrastructure/database/client";

const nodes = [
  ["ai", "人工智能", "AI 测试节点", "#7c3aed", "bot", 10],
  ["site", "建站开发", "建站测试节点", "#2563eb", "code", 20],
  ["host", "主机云服务", "主机测试节点", "#0f766e", "server", 30],
  ["domain", "域名 DNS", "域名测试节点", "#c2410c", "globe", 40],
  ["ops", "运维网络", "运维测试节点", "#0369a1", "network", 50],
  ["showcase", "项目展示", "项目测试节点", "#be185d", "sparkles", 60],
] as const;

export async function ensureCommunityNodeFixtures(): Promise<void> {
  const prisma = getPrismaClient();
  for (const [slug, name, description, color, icon, sortOrder] of nodes) {
    await prisma.communityNode.upsert({
      where: { slug },
      create: { slug, name, description, color, icon, sortOrder },
      update: {
        name,
        description,
        color,
        icon,
        sortOrder,
        visibility: "public",
        archivedAt: null,
      },
    });
  }
}
