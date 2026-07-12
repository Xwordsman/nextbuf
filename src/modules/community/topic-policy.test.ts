import { describe, expect, it } from "vitest";
import { CommunityError } from "@/modules/community/errors";
import { countHttpLinks, isHotTopic, validateTopicInput } from "@/modules/community/topic-policy";

describe("community topic policy", () => {
  it("normalizes valid published topics", () => {
    expect(
      validateTopicInput(
        "  一个   足够清楚的主题标题  ",
        "这里是一段满足发布长度要求的正文，并包含 https://nextbuf.test/docs 。",
        "publish",
      ),
    ).toMatchObject({
      title: "一个 足够清楚的主题标题",
      linkCount: 1,
    });
  });

  it("allows incomplete drafts but rejects invalid published content", () => {
    expect(validateTopicInput("草稿", "", "draft")).toMatchObject({ title: "草稿", body: "" });
    expect(() => validateTopicInput("太短", "正文也太短", "publish")).toThrow(CommunityError);
  });

  it("counts HTTP links and derives hot state without a stored flag", () => {
    expect(countHttpLinks("https://a.test and http://b.test/path")).toBe(2);
    expect(isHotTopic({ replyCount: 5, viewCount: 0, lastActivityAt: new Date() })).toBe(true);
    expect(isHotTopic({ replyCount: 0, viewCount: 99, lastActivityAt: new Date() })).toBe(false);
  });
});
