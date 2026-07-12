import "server-only";

import { queueIdentityEmail } from "@/infrastructure/mail/queue";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

function actionEmail(input: {
  heading: string;
  description: string;
  actionLabel: string;
  url: string;
}) {
  const safeUrl = escapeHtml(input.url);
  return {
    text: `${input.heading}\n\n${input.description}\n\n${input.url}\n\n如果不是你发起的操作，可以忽略这封邮件。`,
    html: `<main style="font-family:system-ui,sans-serif;line-height:1.6;color:#18181b"><h1 style="font-size:20px">${escapeHtml(input.heading)}</h1><p>${escapeHtml(input.description)}</p><p><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px">${escapeHtml(input.actionLabel)}</a></p><p style="font-size:13px;color:#52525b">如果不是你发起的操作，可以忽略这封邮件。</p></main>`,
  };
}

export async function sendVerificationMessage(email: string, url: string): Promise<void> {
  const content = actionEmail({
    heading: "验证你的 NextBuf 邮箱",
    description: "完成邮箱验证后即可登录 NextBuf。验证链接将在规定时间后失效。",
    actionLabel: "验证邮箱",
    url,
  });
  await queueIdentityEmail({
    kind: "email-verification",
    recipient: email,
    subject: "验证你的 NextBuf 邮箱",
    ...content,
  });
}

export async function sendPasswordResetMessage(email: string, url: string): Promise<void> {
  const content = actionEmail({
    heading: "重置你的 NextBuf 密码",
    description: "使用下面的链接设置新密码。重置成功后，其他登录会话将全部失效。",
    actionLabel: "重置密码",
    url,
  });
  await queueIdentityEmail({
    kind: "password-reset",
    recipient: email,
    subject: "重置你的 NextBuf 密码",
    ...content,
  });
}
