import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import { disconnectPrismaClient, getPrismaClient } from "../../src/infrastructure/database/client";

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
    const username = `e2e_${Date.now().toString(36)}_${testInfo.retry}`;
    await page.goto("/account/security");
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=(?:%2F|\/)account(?:%2F|\/)security$/i);

    await page.goto("/auth/sign-up");
    await page.getByLabel("昵称").fill("认证测试用户");
    await page.getByLabel("用户名").fill(username);
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
    await page.getByRole("button", { name: "账户菜单" }).click();
    await expect(page.getByText(`@${username}`, { exact: true })).toBeVisible();
    await expect(page.getByText("TL0", { exact: true })).toBeVisible();
    await page.goto(`/u/${username}`);
    await expect(page.getByRole("heading", { name: "认证测试用户" })).toBeVisible();
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "账号中心" })).toBeVisible();
    await expect(page.getByLabel("@username")).toHaveValue(username);
    await expect(page.getByText(`UID`, { exact: false }).first()).toBeVisible();
    const forbiddenAdminCall = await page.evaluate(async () =>
      fetch("/api/admin/providers/mail/test", { method: "POST" }).then(
        (response) => response.status,
      ),
    );
    expect(forbiddenAdminCall).toBe(403);

    const prisma = getPrismaClient();
    const registeredUser = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.communityRoleAssignment.upsert({
      where: {
        userId_role_scopeKey: { userId: registeredUser.id, role: "admin", scopeKey: "site" },
      },
      create: {
        userId: registeredUser.id,
        role: "admin",
        scopeKey: "site",
        reason: "E2E node creation",
      },
      update: {},
    });
    const nodeSlug = `e2e-node-${Date.now().toString(36)}`;
    await page.goto("/admin/nodes");
    await page.getByLabel("节点标识").fill(nodeSlug);
    await page.getByLabel("名称", { exact: true }).fill("E2E 自定义节点");
    await page.getByLabel("简介", { exact: true }).fill("由浏览器测试显式创建的节点");
    await page.getByRole("button", { name: "创建节点" }).click();
    await expect(page.getByText(nodeSlug, { exact: true })).toBeVisible();
    await prisma.communityRoleAssignment.deleteMany({
      where: { userId: registeredUser.id, role: "admin", scopeKey: "site" },
    });

    const topicTitle = `E2E 用户主题 ${Date.now()}`;
    await page.goto("/topics/new");
    await page.getByLabel("标题").fill(topicTitle);
    await page.getByLabel("节点", { exact: true }).selectOption("site");
    await page
      .getByLabel("正文")
      .fill("这是通过真实浏览器发布的 **Markdown 主题正文**，用于验证完整内容流程。");
    await page.locator('.markdown-editor input[type="file"]').setInputFiles({
      name: "e2e-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("NextBuf E2E attachment"),
    });
    await expect(page.getByLabel("正文")).toHaveValue(/e2e-notes\.txt/);
    await page.getByRole("tab", { name: "预览" }).click();
    await expect(page.getByText("Markdown 主题正文", { exact: true })).toBeVisible();
    const publishResponsePromise = page.waitForResponse(
      (response) => {
        const request = response.request();
        return (
          ["POST", "PATCH"].includes(request.method()) &&
          /^\/api\/community\/topics(?:\/\d+)?$/.test(new URL(response.url()).pathname) &&
          request.postData()?.includes('"action":"publish"') === true
        );
      },
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: "发布主题" }).click();
    const publishResponse = await publishResponsePromise;
    const publishBody = publishResponse.ok()
      ? ""
      : await publishResponse.text().catch(() => "response body unavailable");
    expect(
      publishResponse.ok(),
      `Topic publish returned ${publishResponse.status()}: ${publishBody}`,
    ).toBeTruthy();
    await expect(page).toHaveURL(/\/topics\/\d+$/);
    await expect(page.getByRole("heading", { name: topicTitle })).toBeVisible();
    await expect(page.getByRole("link", { name: "e2e-notes.txt" })).toBeVisible();
    const topicUrl = new URL(page.url()).pathname;
    await page.getByRole("button", { name: /^收藏 0$/ }).click();
    await expect(page.getByRole("button", { name: /^已收藏 1$/ })).toBeVisible();
    await page.getByRole("button", { name: "关注主题" }).click();
    await expect(page.getByRole("button", { name: "已关注" })).toBeVisible();
    await page.getByRole("button", { name: "点赞，当前 0 个赞" }).first().click();
    await expect(page.getByRole("button", { name: "取消点赞，当前 1 个赞" }).first()).toBeVisible();
    await page.goto("/account/bookmarks");
    await expect(page.getByRole("link", { name: topicTitle })).toBeVisible();
    await page.goto("/account/following");
    await expect(page.getByRole("link", { name: topicTitle })).toBeVisible();
    await page.goto("/u/community_fixture");
    await page.getByRole("button", { name: "关注", exact: true }).click();
    await expect(page.getByRole("button", { name: "已关注" })).toBeVisible();
    await page.goto("/account/following");
    await expect(page.getByRole("link", { name: "社区示例用户" })).toBeVisible();
    await page.goto(`/search?q=${encodeURIComponent(topicTitle)}`);
    await expect(page.getByRole("link", { name: topicTitle })).toBeVisible();
    await page.goto(topicUrl);

    await page.getByLabel("回复正文").fill(`这是第一条浏览器回复，并提及 @${username} 验证解析。`);
    await page.getByRole("button", { name: "发布回复" }).click();
    await expect(page).toHaveURL(/\/topics\/\d+\?from=2#post-2$/);
    const firstReply = page.locator("#post-2");
    await expect(firstReply.getByText("这是第一条浏览器回复", { exact: false })).toBeVisible();

    const [recipient, actor, notificationTopic] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { email } }),
      prisma.user.findUniqueOrThrow({ where: { username: "community_fixture" } }),
      prisma.communityTopic.findFirstOrThrow({ where: { title: topicTitle } }),
    ]);
    const notificationPost = await prisma.communityPost.findUniqueOrThrow({
      where: { topicId_position: { topicId: notificationTopic.id, position: 2 } },
    });
    for (const type of ["mention", "followed_topic_reply"] as const) {
      await prisma.notification.create({
        data: {
          recipientId: recipient.id,
          actorId: actor.id,
          topicId: notificationTopic.id,
          postId: notificationPost.id,
          type,
          dedupeKey: `e2e-notification:${recipient.id}:${type}:${Date.now()}`,
          snapshot: {
            actorName: actor.name,
            actorUsername: actor.username,
            topicNumber: notificationTopic.number,
            topicTitle,
            postPosition: 2,
          },
          deliveries: { create: { channel: "in_app", status: "delivered" } },
        },
      });
    }
    await disconnectPrismaClient();
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "通知中心" })).toBeVisible();
    await expect(page.getByRole("link", { name: /通知，2 条未读/ })).toBeVisible();
    await expect(page.locator(".notification-page-item")).toHaveCount(2);
    await page.getByRole("button", { name: "全部已读" }).click();
    await expect(page.getByText("0 条未读")).toBeVisible();
    await page.getByRole("button", { name: "归档" }).first().click();
    await expect(page.locator(".notification-page-item")).toHaveCount(1);
    await page.goto("/account/notifications");
    await page.getByLabel("提及我邮件通知").check();
    await page.getByRole("button", { name: "保存偏好" }).click();
    await expect(page.getByText("通知偏好已保存。")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("提及我邮件通知")).toBeChecked();
    await page.goto(topicUrl);

    await firstReply.getByRole("button", { name: "引用" }).click();
    await expect(page.getByText(/引用 #2/)).toBeVisible();
    await page.getByLabel("回复正文").fill("这是引用第二楼后发布的第二条浏览器回复。");
    const quotedReplyRequestPromise = page.waitForRequest((request) => {
      return (
        request.method() === "POST" &&
        /\/api\/community\/topics\/\d+\/replies$/.test(new URL(request.url()).pathname)
      );
    });
    await page.getByRole("button", { name: "发布回复" }).click();
    const quotedReplyRequest = await quotedReplyRequestPromise;
    expect(quotedReplyRequest.postDataJSON()).toMatchObject({ quotedPosition: 2 });
    await expect(page).toHaveURL(/#post-3$/);
    const secondReply = page.locator("#post-3");
    const secondReplyQuote = secondReply.locator(".reply-quote");
    await expect(secondReplyQuote).toContainText("#2");
    await expect(secondReplyQuote).toContainText("认证测试用户");
    await expect(secondReplyQuote).toContainText("这是第一条浏览器回复");
    await secondReply.getByRole("button", { name: "编辑" }).click();
    await page.getByLabel("编辑第 3 楼回复").fill("这是修改后的第二条浏览器回复。");
    await secondReply.getByRole("button", { name: "保存修改" }).click();
    await expect(
      secondReply.getByText("这是修改后的第二条浏览器回复。", { exact: true }),
    ).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await secondReply.getByRole("button", { name: "删除" }).click();
    await expect(
      secondReply.getByText("该回复已删除，楼层号继续保留。", { exact: true }),
    ).toBeVisible();
    await secondReply.getByRole("button", { name: "恢复" }).click();
    await expect(
      secondReply.getByText("这是修改后的第二条浏览器回复。", { exact: true }),
    ).toBeVisible();

    await page.getByRole("link", { name: "编辑主题" }).click();
    await page
      .getByLabel("正文")
      .fill("这是修改后的 **主题正文**，用于确认 Markdown 修订版本会被持久化。");
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(page).toHaveURL(/\/topics\/\d+$/);
    await page.goto("/account/topics");
    await expect(page.getByRole("link", { name: topicTitle })).toBeVisible();
    await page.getByRole("link", { name: "编辑", exact: true }).click();
    await page.getByRole("button", { name: "删除主题" }).click();
    await expect(page).toHaveURL("/account/topics");
    await expect(page.getByText("已删除", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "编辑", exact: true }).click();
    await page.getByRole("button", { name: "恢复主题" }).click();
    await expect(page).toHaveURL(/\/topics\/\d+\/edit$/);

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
