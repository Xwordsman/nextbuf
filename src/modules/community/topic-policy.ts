import {
  TOPIC_BODY_MAX_LENGTH,
  TOPIC_PUBLISH_BODY_MIN_LENGTH,
  TOPIC_PUBLISH_MAX_LINKS,
  TOPIC_PUBLISH_TITLE_MIN_LENGTH,
  TOPIC_TITLE_MAX_LENGTH,
} from "@/modules/community/contracts/topic-form";
import { CommunityError } from "@/modules/community/errors";

const invalidTitleCharacters = /[\u0000-\u001f\u007f]/;
const invalidBodyCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const httpLinkPattern = /\bhttps?:\/\/[^\s<>()]+/giu;

export const MAX_ACTIVE_TOPIC_DRAFTS = 20;
export const MAX_PUBLISHED_TOPICS_PER_HOUR = 3;

export type ValidatedTopicInput = {
  title: string;
  body: string;
  linkCount: number;
};

export function countHttpLinks(value: string): number {
  return value.match(httpLinkPattern)?.length ?? 0;
}

export function validateTopicInput(
  rawTitle: string,
  rawBody: string,
  mode: "draft" | "publish",
): ValidatedTopicInput {
  const title = rawTitle.trim().replace(/\s+/g, " ");
  const body = rawBody.replaceAll("\r\n", "\n").trim();
  const minimumTitle = mode === "publish" ? TOPIC_PUBLISH_TITLE_MIN_LENGTH : 1;
  const minimumBody = mode === "publish" ? TOPIC_PUBLISH_BODY_MIN_LENGTH : 0;
  const linkCount = countHttpLinks(body);

  if (
    title.length < minimumTitle ||
    title.length > TOPIC_TITLE_MAX_LENGTH ||
    invalidTitleCharacters.test(title) ||
    body.length < minimumBody ||
    body.length > TOPIC_BODY_MAX_LENGTH ||
    invalidBodyCharacters.test(body) ||
    (mode === "publish" && linkCount > TOPIC_PUBLISH_MAX_LINKS)
  ) {
    throw new CommunityError("invalid_topic", 400, {
      titleMin: minimumTitle,
      titleMax: TOPIC_TITLE_MAX_LENGTH,
      bodyMin: minimumBody,
      bodyMax: TOPIC_BODY_MAX_LENGTH,
      linkMax: TOPIC_PUBLISH_MAX_LINKS,
    });
  }

  return { title, body, linkCount };
}

export function isHotTopic(input: {
  replyCount: number;
  viewCount: number;
  lastActivityAt: Date;
}): boolean {
  const activeWithinDays = Date.now() - input.lastActivityAt.getTime() <= 30 * 86_400_000;
  return activeWithinDays && (input.replyCount >= 5 || input.viewCount >= 100);
}
