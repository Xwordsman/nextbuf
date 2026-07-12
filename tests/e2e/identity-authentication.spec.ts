import { expect, test, type Page } from "@playwright/test";

const mailpitUrl = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025";
const oldPassword = "old-password-for-e2e";
const newPassword = "new-password-for-e2e";

type MailpitMessage = {
  ID: string;
  Subject: string;
  To?: Array<{ Address?: string }>;
};

type MailpitMessageDetail = MailpitMessage & {
  Text?: string;
};

async function waitForMail(recipient: string, subject: string): Promise<MailpitMessageDetail> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=100`);
    if (!response.ok) throw new Error(`Mailpit returned ${response.status}`);
    const result = (await response.json()) as { messages?: MailpitMessage[] };
    const message = result.messages?.find(
      (item) =>
        item.Subject === subject && item.To?.some((address) => address.Address === recipient),
    );
    if (message) {
      const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`);
      if (!detailResponse.ok) throw new Error(`Mailpit detail returned ${detailResponse.status}`);
      return (await detailResponse.json()) as MailpitMessageDetail;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Email was not delivered to ${recipient}: ${subject}`);
}

function firstUrl(message: MailpitMessageDetail): string {
  const match = message.Text?.match(/https?:\/\/\S+/);
  if (!match) throw new Error("Email did not contain an action URL");
  return match[0];
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/auth/sign-in");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
}

test.describe.serial("identity authentication", () => {
  test("registers, verifies, manages sessions and resets the password", async ({
    browser,
    page,
  }, testInfo) => {
    const email = `identity-e2e-${Date.now()}-${testInfo.retry}@nextbuf.test`;
    await page.goto("/account/security");
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=(?:%2F|\/)account(?:%2F|\/)security$/i);

    await page.goto("/auth/sign-up");
    await page.getByLabel("昵称").fill("认证测试用户");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码", { exact: true }).fill(oldPassword);
    await page.getByLabel("确认密码").fill(oldPassword);
    await page.getByRole("button", { name: "创建账号" }).click();
    await expect(page).toHaveURL(/\/auth\/check-email\?sent=1$/);
    await expect(page.getByText("如果邮箱对应未验证账号，验证邮件已经发送。")).toBeVisible();

    const verification = await waitForMail(email, "验证你的 NextBuf 邮箱");
    await page.goto(firstUrl(verification));
    await expect(page.getByRole("heading", { name: "邮箱已验证" })).toBeVisible();

    await signIn(page, email, oldPassword);
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: "账户菜单" })).toBeVisible();

    const secondContext = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      locale: "zh-CN",
    });
    const secondPage = await secondContext.newPage();
    await signIn(secondPage, email, oldPassword);
    await expect(secondPage).toHaveURL("/");
    await secondPage.goto("/account/security");
    await expect(secondPage.getByRole("heading", { name: "账号安全" })).toBeVisible();
    await expect(secondPage.locator(".session-item")).toHaveCount(2);

    await secondPage.goto("/auth/forgot-password");
    await secondPage.getByLabel("邮箱").fill(email);
    await secondPage.getByRole("button", { name: "发送重置邮件" }).click();
    await expect(secondPage.getByText("如果账号存在，重置邮件已经发送。")).toBeVisible();

    const reset = await waitForMail(email, "重置你的 NextBuf 密码");
    await secondPage.goto(firstUrl(reset));
    await expect(secondPage.getByRole("heading", { name: "重置密码" })).toBeVisible();
    await secondPage.getByLabel("新密码", { exact: true }).fill(newPassword);
    await secondPage.getByLabel("确认新密码").fill(newPassword);
    await secondPage.getByRole("button", { name: "更新密码" }).click();
    await expect(secondPage.getByText("密码已更新，其他登录会话已经失效。")).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("button", { name: "账户菜单" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "登录" }).first()).toBeVisible();

    await signIn(secondPage, email, oldPassword);
    await expect(secondPage.getByText("邮箱或密码错误，或者邮箱尚未完成验证。")).toBeVisible();
    await secondPage.getByLabel("密码", { exact: true }).fill(newPassword);
    await secondPage.getByRole("button", { name: "登录", exact: true }).click();
    await expect(secondPage).toHaveURL("/");

    await secondPage.goto("/account/security");
    await expect(secondPage.locator(".session-item")).toHaveCount(1);
    await expect(secondPage.getByText("当前设备", { exact: true })).toBeVisible();
    await secondContext.close();
  });
});
