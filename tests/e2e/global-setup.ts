import { existsSync } from "node:fs";

export default async function globalSetup() {
  if (existsSync(".env.test")) process.loadEnvFile(".env.test");
  const [{ setup }, database] = await Promise.all([
    import("../../src/cli/commands/setup"),
    import("../../src/infrastructure/database/client"),
  ]);
  await setup();
  const prisma = database.getPrismaClient();
  await prisma.moderationSanction.deleteMany();
  await prisma.moderationAction.deleteMany();
  await prisma.moderationReport.deleteMany();
  await prisma.moderationCase.deleteMany();
  await prisma.governanceAuditEvent.deleteMany();
  await prisma.communityAuditEvent.deleteMany({ where: { topicId: { not: null } } });
  await prisma.communityRoleAssignment.deleteMany();
  await prisma.communityTopic.deleteMany();

  const user = await prisma.user.upsert({
    where: { email: "community-e2e-fixture@nextbuf.test" },
    create: {
      name: "社区示例用户",
      username: "community_fixture",
      email: "community-e2e-fixture@nextbuf.test",
      emailVerified: true,
      status: "active",
      activatedAt: new Date(),
    },
    update: { name: "社区示例用户", emailVerified: true, status: "active" },
  });
  await prisma.systemState.upsert({
    where: { key: "installation.completed" },
    create: { key: "installation.completed", value: { source: "e2e-fixture" } },
    update: { value: { source: "e2e-fixture" } },
  });
  const nodes = await prisma.communityNode.findMany({ where: { slug: { in: ["ai", "domain"] } } });
  const bySlug = new Map(nodes.map((node) => [node.slug, node]));

  for (const fixture of [
    {
      slug: "ai",
      title: "E2E 人工智能社区主题",
      body: "这是用于验证真实社区首页、节点筛选和主题详情页的人工智能主题。",
      viewCount: 0,
    },
    {
      slug: "domain",
      title: "E2E DNS 解析排查主题",
      body: "这是用于验证搜索、计算型热门状态和域名节点页面的 DNS 主题正文。",
      viewCount: 150,
    },
  ]) {
    const node = bySlug.get(fixture.slug);
    if (!node) throw new Error(`Missing E2E node: ${fixture.slug}`);
    const topic = await prisma.communityTopic.create({
      data: {
        nodeId: node.id,
        authorId: user.id,
        title: fixture.title,
        status: "published",
        publishedAt: new Date(),
        viewCount: fixture.viewCount,
      },
    });
    const post = await prisma.communityPost.create({
      data: {
        topicId: topic.id,
        authorId: user.id,
        position: 1,
        status: "published",
        bodySource: fixture.body,
      },
    });
    await prisma.communityPostRevision.create({
      data: {
        postId: post.id,
        editorId: user.id,
        version: 1,
        title: fixture.title,
        bodySource: fixture.body,
        source: "create",
      },
    });
  }
  await database.disconnectPrismaClient();
}
