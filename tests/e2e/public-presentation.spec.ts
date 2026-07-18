import { expect, test, type Page } from "@playwright/test";

type PublicTarget = {
  name: string;
  path: string;
  heading?: string;
  status?: number;
  testId?: string;
};

async function expectPublicShadcnSurface(page: Page, target: PublicTarget) {
  const response = await page.goto(target.path);
  expect(response?.status(), `${target.path} returned an unexpected status`).toBe(
    target.status ?? 200,
  );
  await expect(page.locator("#main-content")).toBeVisible();

  if (target.heading) {
    await expect(page.getByRole("heading", { name: target.heading, exact: true })).toBeVisible();
  }
  if (target.testId) await expect(page.getByTestId(target.testId)).toBeVisible();

  expect(
    await page.locator("#main-content [data-slot]").count(),
    `${target.path} should render an official shadcn primitive inside the main content`,
  ).toBeGreaterThan(0);
}

test("public routes render official shadcn surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const topicPath = await page
    .getByRole("link", { name: "E2E 人工智能社区主题", exact: true })
    .getAttribute("href");
  expect(topicPath).toMatch(/^\/topics\/\d+$/);

  const targets: PublicTarget[] = [
    { name: "home", path: "/", testId: "community-shell" },
    { name: "node directory", path: "/nodes", heading: "社区节点" },
    { name: "node feed", path: "/nodes/ai", heading: "人工智能" },
    { name: "topic", path: topicPath!, heading: "E2E 人工智能社区主题" },
    { name: "search", path: "/search?q=E2E", heading: "搜索" },
    { name: "sign in", path: "/auth/sign-in", heading: "登录" },
    { name: "sign up", path: "/auth/sign-up", heading: "创建账号" },
    { name: "forgot password", path: "/auth/forgot-password", heading: "找回密码" },
    { name: "reset password", path: "/auth/reset-password", heading: "重置密码" },
    { name: "check email", path: "/auth/check-email", heading: "检查邮箱" },
    { name: "verified", path: "/auth/verified", heading: "邮箱已验证" },
    { name: "completed setup", path: "/setup", heading: "首次安装" },
    { name: "empty state", path: "/status/empty", heading: "这里还没有内容" },
    { name: "unauthorized state", path: "/status/unauthorized", heading: "需要登录后访问" },
    { name: "maintenance state", path: "/status/maintenance", heading: "正在维护" },
    { name: "unavailable state", path: "/status/unavailable", heading: "功能尚未开放" },
    { name: "not found", path: "/this-route-does-not-exist", heading: "页面不存在", status: 404 },
  ];

  for (const target of targets) {
    await test.step(target.name, async () => {
      await expectPublicShadcnSurface(page, target);
    });
  }
});
