import { describe, expect, it } from "vitest";
import {
  extractAttachmentIds,
  extractMentionUsernames,
  isSafeRemoteResourceUrl,
  safeMarkdownLink,
  validateReplyBody,
} from "@/modules/community/content-policy";

describe("community content policy", () => {
  it("extracts unique mentions and attachment references", () => {
    expect(extractMentionUsernames("你好 @Alice 和 @alice，抄送 @user_1000")).toEqual([
      "alice",
      "user_1000",
    ]);
    expect(
      extractAttachmentIds(
        "![a](/api/media/attachments/10000000-0000-4000-8000-000000000001)\n" +
          "[b](/api/media/attachments/10000000-0000-4000-8000-000000000001)",
      ),
    ).toEqual(["10000000-0000-4000-8000-000000000001"]);
  });

  it("enforces reply length, link and mention limits", () => {
    expect(validateReplyBody("  有效回复  ")).toBe("有效回复");
    expect(() => validateReplyBody("a")).toThrowError("invalid_post");
    expect(() =>
      validateReplyBody(
        "https://a.test https://b.test https://c.test https://d.test https://e.test https://f.test",
      ),
    ).toThrowError("invalid_post");
  });

  it("rejects dangerous links and private remote resource targets", () => {
    expect(safeMarkdownLink("javascript:alert(1)")).toBeNull();
    expect(safeMarkdownLink("/topics/1")).toBe("/topics/1");
    expect(safeMarkdownLink("/\\evil.example/path")).toBeNull();
    expect(safeMarkdownLink("//evil.example/path")).toBeNull();
    expect(isSafeRemoteResourceUrl("http://127.0.0.1/file")).toBe(false);
    expect(isSafeRemoteResourceUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeRemoteResourceUrl("https://example.com/image.png")).toBe(true);
  });
});
