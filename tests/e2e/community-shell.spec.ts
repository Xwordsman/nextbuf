import { stat } from "node:fs/promises";
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
  await expect(page.getByTestId("topic-count")).toContainText(/共 \d+ 个话题/);
}

test.describe("community shell", () => {
  test("preserves the approved desktop grid for anonymous visitors", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page);

    const shell = page.getByTestId("community-shell");
    const left = page.getByTestId("community-left-rail");
    const main = page.getByTestId("community-main");
    const right = page.getByTestId("community-right-rail");
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

  test("keeps last-reply metadata beside view counts", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page);

    const row = page
      .getByRole("heading", { name: "E2E 人工智能社区主题", exact: true })
      .locator("xpath=ancestor::article");
    const views = row.getByTestId("topic-views");
    const lastReply = row.getByTestId("topic-last-reply");
    const [viewsBox, lastReplyBox] = await Promise.all([
      views.evaluate((element) => element.getBoundingClientRect().toJSON()),
      lastReply.evaluate((element) => element.getBoundingClientRect().toJSON()),
    ]);

    expect(lastReplyBox.x).toBeGreaterThan(viewsBox.x);
    expect(lastReplyBox.x - (viewsBox.x + viewsBox.width)).toBeLessThanOrEqual(24);
    expect(lastReplyBox.y).toBeCloseTo(viewsBox.y, 0);
  });

  test("keeps topic details inside the community three-column shell", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page);
    const topicHref = await page
      .getByRole("link", { name: "E2E 人工智能社区主题", exact: true })
      .getAttribute("href");
    expect(topicHref).toMatch(/^\/topics\/\d+$/);

    await page.goto(topicHref!);
    const shell = page.getByTestId("community-shell");
    const left = page.getByTestId("community-left-rail");
    const main = page.getByTestId("community-main");
    const right = page.getByTestId("community-right-rail");
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
    await expect(page.getByRole("heading", { name: "E2E 人工智能社区主题" })).toBeVisible();
    await expect(left.getByRole("link", { name: /人工智能/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(right).toBeVisible();
    await captureFullPage(page, testInfo, "topic-desktop-1440");

    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(right).toBeHidden();
    await page.getByRole("button", { name: "我的面板" }).click();
    const dialog = page.getByRole("dialog", { name: "我的面板" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "加入社区" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
  });

  test("filters topics through search and node navigation", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page);

    await page.getByLabel("搜索话题、节点或作者").fill("E2E DNS");
    await expect(page.getByTestId("topic-count")).toHaveText("共 1 个话题");
    await expect(page.getByRole("heading", { name: /E2E DNS 解析排查主题/ })).toBeVisible();

    await page.getByLabel("搜索话题、节点或作者").fill("");
    await page
      .getByRole("navigation", { name: "社区节点" })
      .getByRole("link", { name: /人工智能/ })
      .click();
    await expect(page).toHaveURL(/\/nodes\/ai$/);
    await expect(page.getByTestId("topic-count")).toHaveText("共 1 个话题");
  });

  test("uses a two-column layout and account panel on tablet", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await openHome(page);

    await expect(page.getByTestId("community-left-rail")).toBeVisible();
    await expect(page.getByTestId("community-right-rail")).toBeHidden();
    await page.getByRole("button", { name: "我的面板" }).click();
    const dialog = page.getByRole("dialog", { name: "我的面板" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "加入社区" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await expectNoHorizontalOverflow(page);
    await captureFullPage(page, testInfo, "tablet-1024");
  });

  test("keeps the account panel accessible through the 1100px rail breakpoint", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1099, height: 900 });
    await openHome(page);

    await expect(page.getByTestId("community-right-rail")).toBeHidden();
    await expect(page.getByRole("button", { name: "我的面板" })).toBeVisible();
  });

  test("supports mobile search and compact layout", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);

    await page.getByRole("button", { name: "搜索" }).click();
    await page.locator("#mobile-search").fill("E2E DNS");
    await expect(page.getByTestId("topic-count")).toHaveText("共 1 个话题");
    await expect(page.getByRole("link", { name: "登录" }).first()).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await captureFullPage(page, testInfo, "mobile-390");
  });
});
