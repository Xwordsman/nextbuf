import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 1024, height: 900 },
  { name: "desktop", width: 1440, height: 1000 },
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectAccessiblePage(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.ok(), `Expected ${path} to load successfully`).toBe(true);
  await expect(page.locator("#main-content")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const results = await new AxeBuilder({ page }).analyze();
  const blockingViolations = results.violations
    .filter(({ impact }) => impact === "serious" || impact === "critical")
    .map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      targets: nodes.map((node) => node.target),
    }));

  expect(blockingViolations, `${path} has blocking accessibility violations`).toEqual([]);
}

for (const viewport of viewports) {
  test(`${viewport.name} public pages pass accessibility gates`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    const topicPath = await page
      .getByRole("link", { name: "E2E DNS 解析排查主题", exact: true })
      .getAttribute("href");
    expect(topicPath).toMatch(/^\/topics\/\d+$/);

    for (const target of [
      { name: "home", path: "/" },
      { name: "node", path: "/nodes/domain" },
      { name: "search", path: "/search?q=E2E" },
      { name: "topic", path: topicPath! },
    ]) {
      await test.step(target.name, async () => {
        await expectAccessiblePage(page, target.path);
      });
    }
  });
}

test("keyboard navigation and reduced motion remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
  const motionDurations = await page.locator(".skip-link").evaluate((element) => {
    const styles = getComputedStyle(element);
    return [parseFloat(styles.animationDuration), parseFloat(styles.transitionDuration)];
  });
  expect(motionDurations.every((duration) => duration <= 0.00001)).toBe(true);
});
