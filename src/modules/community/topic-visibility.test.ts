import { describe, expect, it } from "vitest";
import {
  isPrivateTopicDraftLineage,
  managedTopicWhere,
  restoredTopicStatus,
} from "@/modules/community/topic-visibility";

describe("topic draft visibility", () => {
  it("keeps active and deleted draft lineages private", () => {
    expect(isPrivateTopicDraftLineage({ status: "draft" })).toBe(true);
    expect(isPrivateTopicDraftLineage({ status: "deleted", deletedFromStatus: "draft" })).toBe(
      true,
    );
    expect(isPrivateTopicDraftLineage({ status: "deleted", deletedFromStatus: null })).toBe(true);
    expect(isPrivateTopicDraftLineage({ status: "deleted", deletedFromStatus: "published" })).toBe(
      false,
    );
    expect(isPrivateTopicDraftLineage({ status: "published" })).toBe(false);
  });

  it("does not turn an unsupported status filter into draft access", () => {
    expect(managedTopicWhere("draft")).toEqual({ status: { in: [] } });
    expect(managedTopicWhere("deleted")).toMatchObject({
      status: "deleted",
      deletedFromStatus: { in: ["published", "closed", "hidden"] },
    });
  });

  it("restores unknown or missing deleted origins as private drafts", () => {
    expect(restoredTopicStatus("published")).toBe("published");
    expect(restoredTopicStatus("closed")).toBe("closed");
    expect(restoredTopicStatus("hidden")).toBe("hidden");
    expect(restoredTopicStatus("draft")).toBe("draft");
    expect(restoredTopicStatus(null)).toBe("draft");
    expect(restoredTopicStatus("unexpected-status")).toBe("draft");
  });
});
