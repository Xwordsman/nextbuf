import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import { disconnectPrismaClient, getPrismaClient } from "../../src/infrastructure/database/client";
import {
  EDITOR_AUTOSAVE_DELAY_MS,
  EDITOR_WRITE_TIMEOUT_MS,
} from "../../src/shared/community/editor-session";

const mailpitUrl = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025";
const oldPassword = "old-password-for-e2e";
const newPassword = "new-password-for-e2e";
const networkBarrierFailsafeMs = EDITOR_WRITE_TIMEOUT_MS - 5_000;

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test.describe.serial("identity authentication", () => {
  test("registers, verifies, manages sessions and resets the password", async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
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
    await page.goto("/account/activity");
    await expect(page.getByRole("heading", { name: "我的参与" })).toBeVisible();
    expect(await page.locator("#main-content [data-slot]").count()).toBeGreaterThan(0);
    await page.goto("/account/trust");
    await expect(page.getByRole("heading", { name: "信任等级" })).toBeVisible();
    expect(await page.locator("#main-content [data-slot]").count()).toBeGreaterThan(0);
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
    await page.goto("/admin/nodes/new");
    await page.getByLabel("节点标识").fill(nodeSlug);
    await page.getByLabel("名称", { exact: true }).fill("E2E 自定义节点");
    await page.getByLabel("简介", { exact: true }).fill("由浏览器测试显式创建的节点");
    await page.getByRole("button", { name: "创建节点" }).click();
    await expect(page).toHaveURL(`/admin/nodes/${nodeSlug}`);
    await expect(page.getByText(nodeSlug, { exact: true })).toBeVisible();
    await page.goto("/admin/content/topics");
    await page.getByLabel("主题状态").click();
    await expect(page.getByRole("option", { name: "草稿", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto("/admin/content/replies");
    await page.getByLabel("回复状态").click();
    await expect(page.getByRole("option", { name: "草稿", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    const privateDraftSuffix = Date.now().toString(36);
    const privateDraftOwner = await prisma.user.create({
      data: {
        name: "E2E 私人草稿作者",
        username: `draft_owner_${privateDraftSuffix}`.slice(0, 24),
        email: `draft-owner-${privateDraftSuffix}@nextbuf.test`,
        emailVerified: true,
        status: "active",
        activatedAt: new Date(),
      },
    });
    const privateDraftNode = await prisma.communityNode.findUniqueOrThrow({
      where: { slug: "ai" },
    });
    const privateDraft = await prisma.communityTopic.create({
      data: {
        nodeId: privateDraftNode.id,
        authorId: privateDraftOwner.id,
        title: "E2E 管理员不可枚举的私人草稿",
        status: "draft",
        posts: {
          create: {
            authorId: privateDraftOwner.id,
            position: 1,
            status: "draft",
            bodySource: "管理员对按编号写入入口发起请求时，只能得到与不存在主题相同的响应。",
          },
        },
      },
    });
    try {
      const privateDraftResponses = await page.evaluate(async (number) => {
        const payloads = [
          {
            action: "save",
            nodeSlug: "ai",
            title: "管理员不能修改私人草稿",
            body: "这是一个格式完整但必须被伪装成主题不存在的内容修改请求。",
            editorSessionKey: crypto.randomUUID(),
            editorSessionRevision: 1,
          },
          { action: "delete" },
          { action: "restore" },
          {
            action: "moderate",
            isPinned: false,
            isEssence: false,
            isClosed: false,
            isHidden: false,
          },
        ];
        const results: Array<{ status: number; code?: string }> = [];
        for (const payload of payloads) {
          const response = await fetch(`/api/community/topics/${number}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          });
          const body = (await response.json()) as { code?: string };
          results.push({ status: response.status, code: body.code });
        }
        return results;
      }, privateDraft.number);
      expect(privateDraftResponses).toEqual(
        Array.from({ length: 4 }, () => ({ status: 404, code: "topic_not_found" })),
      );
    } finally {
      await prisma.communityTopic.delete({ where: { id: privateDraft.id } });
      await prisma.user.delete({ where: { id: privateDraftOwner.id } });
    }
    await prisma.communityRoleAssignment.deleteMany({
      where: { userId: registeredUser.id, role: "admin", scopeKey: "site" },
    });

    const legacyTopicWriteStatus = await page.evaluate(async () =>
      fetch("/api/community/topics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeSlug: "ai",
          title: "缺少编辑会话的旧客户端主题",
          body: "这个请求必须在进入领域服务前被拒绝，不能创建重复草稿。",
          action: "draft",
        }),
      }).then((response) => response.status),
    );
    expect(legacyTopicWriteStatus).toBe(400);
    const oversizedTopicRevisionStatus = await page.evaluate(async () =>
      fetch("/api/community/topics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nodeSlug: "ai",
          title: "超过 PostgreSQL INTEGER 上限的编辑版本",
          body: "这个请求必须在进入数据库前被拒绝，不能触发数值溢出。",
          action: "draft",
          editorSessionKey: crypto.randomUUID(),
          editorSessionRevision: 2_147_483_648,
        }),
      }).then((response) => response.status),
    );
    expect(oversizedTopicRevisionStatus).toBe(400);

    const topicTitle = `E2E 用户主题 ${Date.now()}`;
    const releaseTopicAutosave = deferred();
    const topicWrites: Array<{ method: string; action?: string }> = [];
    let heldTopicAutosave = false;
    await page.route(/\/api\/community\/topics(?:\/\d+)?$/, async (route) => {
      const request = route.request();
      const payload = request.postDataJSON() as { action?: string };
      topicWrites.push({ method: request.method(), action: payload.action });
      if (!heldTopicAutosave && request.method() === "POST" && payload.action === "draft") {
        heldTopicAutosave = true;
        await Promise.race([
          releaseTopicAutosave.promise,
          new Promise((resolve) => setTimeout(resolve, networkBarrierFailsafeMs)),
        ]);
      }
      await route.continue();
    });
    await page.goto("/topics/new");
    await page.getByLabel("标题").fill(topicTitle);
    await page.getByLabel("节点", { exact: true }).click();
    await page.getByRole("option", { name: "建站开发", exact: true }).click();
    await page
      .getByLabel("正文")
      .fill("这是通过真实浏览器发布的 **Markdown 主题正文**，用于验证完整内容流程。");
    const releaseAttachmentUpload = deferred();
    let heldAttachmentUpload = false;
    await page.route(/\/api\/community\/attachments$/, async (route) => {
      heldAttachmentUpload = true;
      await Promise.race([
        releaseAttachmentUpload.promise,
        new Promise((resolve) => setTimeout(resolve, networkBarrierFailsafeMs)),
      ]);
      await route.continue();
    });
    await page.getByLabel("选择附件").setInputFiles({
      name: "e2e-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("NextBuf E2E attachment"),
    });
    await expect.poll(() => heldAttachmentUpload, { timeout: 10_000 }).toBe(true);
    try {
      const bodyWhileUploading = `${await page.getByLabel("正文").inputValue()}\n\n上传期间继续输入的内容也必须保留。`;
      await page.getByLabel("正文").fill(bodyWhileUploading);
      await page.getByRole("tab", { name: "预览" }).click();
      await expect(page.getByRole("button", { name: "发布主题" })).toBeDisabled();
    } finally {
      releaseAttachmentUpload.resolve();
    }
    await expect(page.getByLabel("正文")).toHaveValue(/e2e-notes\.txt/);
    await expect(page.getByLabel("正文")).toHaveValue(/上传期间继续输入的内容也必须保留/);
    await page.unroute(/\/api\/community\/attachments$/);
    await page.getByRole("tab", { name: "预览" }).click();
    await expect(page.getByText("Markdown 主题正文", { exact: true })).toBeVisible();
    await expect.poll(() => heldTopicAutosave, { timeout: 10_000 }).toBe(true);
    let publishResponsePromise!: ReturnType<Page["waitForResponse"]>;
    try {
      await page.getByRole("tab", { name: "编写" }).click();
      const topicBody = await page.getByLabel("正文").inputValue();
      await page.getByLabel("正文").fill(`${topicBody}\n\n这是自动保存期间输入的最终正文。`);
      await page.waitForTimeout(EDITOR_AUTOSAVE_DELAY_MS + 200);
      publishResponsePromise = page.waitForResponse(
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
      await page.waitForTimeout(250);
      expect(topicWrites).toHaveLength(1);
      expect(topicWrites.filter((write) => write.action === "publish")).toHaveLength(0);
    } finally {
      releaseTopicAutosave.resolve();
    }
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
    expect(topicWrites.filter((write) => write.action === "draft")).toHaveLength(1);
    expect(topicWrites.filter((write) => write.action === "publish")).toHaveLength(1);
    await page.unroute(/\/api\/community\/topics(?:\/\d+)?$/);
    const persistedTopics = await prisma.communityTopic.findMany({
      where: { authorId: registeredUser.id, title: topicTitle },
      include: { posts: { where: { position: 1 }, take: 1 } },
    });
    expect(persistedTopics).toHaveLength(1);
    expect(persistedTopics[0]).toMatchObject({ status: "published" });
    expect(persistedTopics[0]?.posts[0]?.bodySource).toContain("这是自动保存期间输入的最终正文。");
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

    const legacyReplyWriteStatus = await page.evaluate(async () =>
      fetch(`${window.location.pathname}/replies`.replace("/topics/", "/api/community/topics/"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "缺少编辑会话的旧客户端回复草稿" }),
      }).then((response) => response.status),
    );
    expect(legacyReplyWriteStatus).toBe(400);

    const releaseReplyAutosave = deferred();
    const replyWrites: Array<{ method: string }> = [];
    let heldReplyAutosave = false;
    await page.route(/\/api\/community\/topics\/\d+\/replies$/, async (route) => {
      const request = route.request();
      replyWrites.push({ method: request.method() });
      if (!heldReplyAutosave && request.method() === "PUT") {
        heldReplyAutosave = true;
        await Promise.race([
          releaseReplyAutosave.promise,
          new Promise((resolve) => setTimeout(resolve, networkBarrierFailsafeMs)),
        ]);
      }
      await route.continue();
    });
    await page.getByLabel("回复正文").fill(`这是第一条浏览器回复，并提及 @${username} 验证解析。`);
    await expect.poll(() => heldReplyAutosave, { timeout: 10_000 }).toBe(true);
    try {
      await page
        .getByLabel("回复正文")
        .fill(`这是第一条浏览器回复，并提及 @${username} 验证解析，保留最终版本。`);
      await page.waitForTimeout(EDITOR_AUTOSAVE_DELAY_MS + 200);
      await page.getByRole("button", { name: "发布回复" }).click();
      await page.waitForTimeout(250);
      expect(replyWrites).toEqual([{ method: "PUT" }]);
    } finally {
      releaseReplyAutosave.resolve();
    }
    await expect(page).toHaveURL(/\/topics\/\d+\?from=2#post-2$/);
    expect(replyWrites.filter((write) => write.method === "PUT")).toHaveLength(1);
    expect(replyWrites.filter((write) => write.method === "POST")).toHaveLength(1);
    await page.unroute(/\/api\/community\/topics\/\d+\/replies$/);
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
    expect(notificationPost.bodySource).toContain("保留最终版本");
    await expect(
      prisma.communityPostDraft.count({
        where: { topicId: notificationTopic.id, authorId: recipient.id },
      }),
    ).resolves.toBe(0);
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
    await expect(page.getByTestId("notification-item")).toHaveCount(2);
    await page.getByRole("button", { name: "全部已读" }).click();
    await expect(page.getByTestId("unread-notification-count")).toHaveText("0");
    await page.getByRole("button", { name: "归档" }).first().click();
    await expect(page.getByTestId("notification-item")).toHaveCount(1);
    await page.goto("/account/notifications");
    await page.getByLabel("提及我邮件通知").check();
    await page.getByRole("button", { name: "保存偏好" }).click();
    await expect(page.getByText("通知偏好已保存。")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("提及我邮件通知")).toBeChecked();
    await page.goto(topicUrl);

    await firstReply.getByRole("button", { name: "引用" }).click();
    await expect(page.getByText(/引用 #1/)).toBeVisible();
    await page.getByLabel("回复正文").fill("这是引用第一条回复后发布的第二条浏览器回复。");
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
    const secondReplyQuote = secondReply.getByTestId("reply-quote");
    await expect(secondReplyQuote).toContainText("#1");
    await expect(secondReplyQuote).toContainText("认证测试用户");
    await expect(secondReplyQuote).toContainText("这是第一条浏览器回复");
    await secondReply.getByRole("button", { name: "编辑" }).click();
    await page.getByLabel("编辑第 2 楼回复").fill("这是修改后的第二条浏览器回复。");
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

    const supersededSessionKey = globalThis.crypto.randomUUID();
    await prisma.communityReplyEditorSession.create({
      data: {
        topicId: notificationTopic.id,
        authorId: registeredUser.id,
        key: supersededSessionKey,
        revision: 1,
        state: "superseded",
      },
    });
    await page.evaluate(
      ({ key, topicNumber }) => {
        const state =
          history.state && typeof history.state === "object" ? { ...history.state } : {};
        state.nextbufReplyEditorSession = {
          key,
          revision: 1,
          topicNumber,
          path: `${location.pathname}${location.search}`,
        };
        history.replaceState(state, "", location.href);
      },
      { key: supersededSessionKey, topicNumber: notificationTopic.number },
    );
    const supersededRecoveryPattern =
      /\/api\/community\/topics\/\d+\/replies\/editor-session\/[^/]+$/;
    let supersededRecoveryRequests = 0;
    await page.route(supersededRecoveryPattern, async (route) => {
      supersededRecoveryRequests += 1;
      await route.continue();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() =>
        page.evaluate(() =>
          history.state && typeof history.state === "object"
            ? history.state.nextbufReplyEditorSession
            : undefined,
        ),
      )
      .toBeUndefined();
    await expect(page.getByLabel("回复正文")).toBeVisible();
    expect(supersededRecoveryRequests).toBe(1);
    await page.unroute(supersededRecoveryPattern);
    await prisma.communityReplyEditorSession.delete({
      where: { authorId_key: { authorId: registeredUser.id, key: supersededSessionKey } },
    });

    const responseLossBody = "这条回复已提交，但浏览器会被测试故意丢弃响应。";
    let responseLossPosition = 0;
    await page.route(/\/api\/community\/topics\/\d+\/replies$/, async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || !request.postData()?.includes(responseLossBody)) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const result = (await response.json()) as { position?: number };
      responseLossPosition = result.position ?? 0;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"ok":true,"position":',
      });
    });
    await page.getByLabel("回复正文").fill(responseLossBody);
    await page.getByRole("button", { name: "发布回复" }).click();
    await expect(page.getByText("无法确认回复是否已经发布", { exact: false })).toBeVisible();
    await expect.poll(() => responseLossPosition, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`#post-${responseLossPosition}$`));
    await page.unroute(/\/api\/community\/topics\/\d+\/replies$/);
    await expect(
      prisma.communityPost.count({
        where: {
          topicId: notificationTopic.id,
          authorId: registeredUser.id,
          bodySource: responseLossBody,
        },
      }),
    ).resolves.toBe(1);

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
    await expect(secondPage.getByTestId("session-item")).toHaveCount(2);

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
    await expect(secondPage.getByTestId("session-item")).toHaveCount(1);
    await expect(secondPage.getByText("当前设备", { exact: true })).toBeVisible();
    await secondContext.close();
  });
});
