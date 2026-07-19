import { describe, expect, it } from "vitest";
import {
  postReferenceLabel,
  replyFloorLabel,
  replyFloorNumber,
  replyFloorPermalinkLabel,
} from "@/shared/community/reply-floor";

describe("public reply floor labels", () => {
  it("starts public reply floors at one while preserving internal post positions", () => {
    expect(replyFloorNumber(2)).toBe(1);
    expect(replyFloorNumber(31)).toBe(30);
    expect(replyFloorLabel(2)).toBe("#1");
    expect(replyFloorPermalinkLabel(2)).toBe("第 1 楼永久链接");
  });

  it("keeps the topic first post distinct from reply floors", () => {
    expect(postReferenceLabel(1)).toBe("主题首帖");
    expect(postReferenceLabel(2)).toBe("#1");
    expect(() => replyFloorNumber(1)).toThrow(RangeError);
  });
});
