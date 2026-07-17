import { expect, test } from "@playwright/test";

function percentile(values: number[], ratio: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

test("captures repeatable public read latency budgets", async ({ page, request }, testInfo) => {
  await page.goto("/");
  const topicLink = page.getByRole("link", { name: "E2E 人工智能社区主题", exact: true });
  await expect(topicLink).toBeVisible();
  const topicPath = await topicLink.getAttribute("href");
  expect(topicPath).toMatch(/^\/topics\/\d+$/u);

  const results = [];
  for (const path of ["/", "/search?q=E2E", topicPath!]) {
    const durations = [];
    for (let index = 0; index < 10; index += 1) {
      const startedAt = performance.now();
      const response = await request.get(path, { timeout: 10_000 });
      durations.push(performance.now() - startedAt);
      expect(response.ok(), `${path} returned ${response.status()}`).toBe(true);
    }
    results.push({
      path,
      samples: durations.length,
      p50Ms: Math.round(percentile(durations, 0.5)),
      p95Ms: Math.round(percentile(durations, 0.95)),
      maxMs: Math.round(Math.max(...durations)),
    });
  }

  await testInfo.attach("beta-read-latency.json", {
    body: Buffer.from(`${JSON.stringify(results, null, 2)}\n`),
    contentType: "application/json",
  });
  for (const result of results) expect(result.p95Ms, result.path).toBeLessThan(3_000);
});
