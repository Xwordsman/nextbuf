import { isIP } from "node:net";
import { CommunityError } from "@/modules/community/errors";
import { countHttpLinks } from "@/modules/community/topic-policy";

export const POST_BODY_MAX_LENGTH = 20_000;
export const REPLY_BODY_MIN_LENGTH = 2;
export const REPLY_MAX_LINKS = 5;
export const REPLY_MAX_MENTIONS = 10;
export const MAX_REPLIES_PER_HOUR = 20;

const invalidBodyCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const mentionPattern = /(^|[^a-z0-9_])@([a-z][a-z0-9_]{2,23})(?![a-z0-9_])/giu;
const attachmentPattern =
  /\/api\/media\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/giu;

export function normalizePostBody(rawBody: string): string {
  return rawBody.replaceAll("\r\n", "\n").trim();
}

export function validateReplyBody(rawBody: string): string {
  const body = normalizePostBody(rawBody);
  const linkCount = countHttpLinks(body);
  const mentions = extractMentionUsernames(body);
  if (
    body.length < REPLY_BODY_MIN_LENGTH ||
    body.length > POST_BODY_MAX_LENGTH ||
    invalidBodyCharacters.test(body) ||
    linkCount > REPLY_MAX_LINKS ||
    mentions.length > REPLY_MAX_MENTIONS
  ) {
    throw new CommunityError("invalid_post", 400, {
      bodyMin: REPLY_BODY_MIN_LENGTH,
      bodyMax: POST_BODY_MAX_LENGTH,
      linkMax: REPLY_MAX_LINKS,
      mentionMax: REPLY_MAX_MENTIONS,
    });
  }
  return body;
}

export function validateReplyDraft(rawBody: string): string {
  const body = normalizePostBody(rawBody);
  if (body.length > POST_BODY_MAX_LENGTH || invalidBodyCharacters.test(body)) {
    throw new CommunityError("invalid_post", 400, { bodyMax: POST_BODY_MAX_LENGTH });
  }
  return body;
}

export function extractMentionUsernames(source: string): string[] {
  const usernames = new Set<string>();
  for (const match of source.matchAll(mentionPattern)) {
    const username = match[2];
    if (username) usernames.add(username.toLowerCase());
  }
  return [...usernames];
}

export function extractAttachmentIds(source: string): string[] {
  const ids = new Set<string>();
  for (const match of source.matchAll(attachmentPattern)) {
    const id = match[1];
    if (id) ids.add(id.toLowerCase());
  }
  return [...ids];
}

export function isAttachmentMediaPath(value: string): boolean {
  return new RegExp(`^${attachmentPattern.source}$`, "iu").test(value);
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first === 0
  );
}

export function isSafeRemoteResourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local")
    ) {
      return false;
    }
    const family = isIP(hostname);
    if (family === 4) return !isPrivateIpv4(hostname);
    if (family === 6) {
      return !(
        hostname === "::" ||
        hostname === "::1" ||
        hostname.startsWith("fc") ||
        hostname.startsWith("fd") ||
        hostname.startsWith("fe8") ||
        hostname.startsWith("fe9") ||
        hostname.startsWith("fea") ||
        hostname.startsWith("feb")
      );
    }
    return true;
  } catch {
    return false;
  }
}

export function safeMarkdownLink(value: string): string | null {
  if (value.startsWith("/") && !value.startsWith("//")) {
    const base = new URL("https://nextbuf.invalid");
    const resolved = new URL(value, base);
    return resolved.origin === base.origin ? value : null;
  }
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}
