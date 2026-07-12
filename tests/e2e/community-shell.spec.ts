import { stat } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function captureFullPage(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  expect((await stat(path)).size).toBeGreaterThan(20_000);
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function openHome(page: Page) {
  const response = await page.goto("/");
  const shell = page.getByTestId("community-shell");
  if ((await shell.count()) === 0) {
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(
      `Community shell did not render: status=${response?.status()} title=${JSON.stringify(await page.title())} body=${JSON.stringify(body)}`,
    );
  }
  await expect(shell).toBeVisible();
  await expect(page.locator(".topic-count")).toContainText(/共 \d+ 个话题/);
}

test.describe("community shell", () => {
  test("preserves the approved desktop grid for anonymous visitors", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page);

    const shell = page.getByTestId("community-shell");
    const left = shell.locator(".left-column");
    const main = shell.locator(".main-column");
    const right = shell.locator(".right-column");
    const [shellBox, leftBox, mainBox, rightBox] = await Promise.all([
      shell.evaluate((element) => element.getBoundingClientRect().toJSON()),
      left.evaluate((element) => element.getBoundingClientRect().toJSON()),
      main.evaluate((element) => element.getBoundingClientRect().toJSON()),
      right.evaluate((element) => element.getBoundingClientRect().toJSON()),
    ]);

    expect(shellBox.width).toBeGreaterThanOrEqual(1379);
    expect(shellBox.width).toBeLessThanOrEqual(1380);
    expect(leftBox.width).toBeCloseTo(230, 0);
    expect(rightBox.width).toBeCloseTo(300, 0);
    expect(mainBox.x - (leftBox.x + leftBox.width)).toBeCloseTo(16, 0);
    expect(rightBox.x - (mainBox.x + mainBox.width)).toBeCloseTo(16, 0);

    await expect(page.getByRole("link", { name: "登录" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "注册" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "账户菜单" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "通知" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "发帖" })).toHaveCount(0);
    await expect(page.getByText("@linan", { exact: true })).toHaveCount(0);
    await expect(page.getByText("UID 10086", { exact: true })).toHaveCount(0);
    await expect(page.getByText("TL3", { exact: true })).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
    await captureFullPage(page, testInfo, "desktop-1440");
  });

  test("filters topics through search and node navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page);

    await page.getByLabel("搜索话题、节点或作者").fill("E2E DNS");
    await expect(page.getByText("共 1 个话题", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /E2E DNS 解析排查主题/ })).toBeVisible();

    await page.getByLabel("搜索话题、节点或作者").fill("");
    await page.locator('.node-navigation-item[href="/nodes/ai"]').click();
    await expect(page).toHaveURL(/\/nodes\/ai$/);
    await expect(page.getByText("共 1 个话题", { exact: true })).toBeVisible();
  });

  test("uses a two-column layout and account panel on tablet", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await openHome(page);

    await expect(page.locator(".left-column")).toBeVisible();
    await expect(page.locator(".right-column")).toBeHidden();
    await page.getByRole("button", { name: "我的面板" }).click();
    const dialog = page.getByRole("dialog", { name: "我的面板" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "加入社区" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await expectNoHorizontalOverflow(page);
    await captureFullPage(page, testInfo, "tablet-1024");
  });

  test("supports mobile search and compact layout", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);

    await page.getByRole("button", { name: "搜索" }).click();
    await page.locator("#mobile-search").fill("E2E DNS");
    await expect(page.getByText("共 1 个话题", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "登录" }).first()).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await captureFullPage(page, testInfo, "mobile-390");
  });

  test("has no serious or critical automated accessibility violations", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page);

    const results = await new AxeBuilder({ page }).analyze();
    const blockingViolations = results.violations.filter(({ impact }) =>
      ["serious", "critical"].includes(impact ?? ""),
    );

    expect(blockingViolations).toEqual([]);
  });
});
