import type { Prisma } from "@/generated/prisma/client";

const managedTopicStatuses = ["published", "closed", "hidden"];
const deletedPublicTopicStatuses = ["published", "closed", "hidden"];
const managedPostStatuses = ["published", "hidden", "deleted"];

export function restoredTopicStatus(deletedFromStatus?: string | null) {
  return deletedPublicTopicStatuses.includes(deletedFromStatus ?? "")
    ? (deletedFromStatus as "published" | "closed" | "hidden")
    : "draft";
}

export function isPrivateTopicDraftLineage(topic: {
  status: string;
  deletedFromStatus?: string | null;
}): boolean {
  if (topic.status === "draft") return true;
  if (topic.status !== "deleted") return false;
  return !deletedPublicTopicStatuses.includes(topic.deletedFromStatus ?? "");
}

export function managedTopicWhere(requestedStatus?: string): Prisma.CommunityTopicWhereInput {
  if (managedTopicStatuses.includes(requestedStatus ?? "")) {
    return { status: requestedStatus };
  }
  if (requestedStatus === "deleted") {
    return {
      status: "deleted",
      deletedFromStatus: { in: [...deletedPublicTopicStatuses] },
    };
  }
  if (requestedStatus && requestedStatus !== "all") {
    return { status: { in: [] } };
  }
  return {
    OR: [
      { status: { in: [...managedTopicStatuses] } },
      {
        status: "deleted",
        deletedFromStatus: { in: [...deletedPublicTopicStatuses] },
      },
    ],
  };
}

export function managedPostWhere(): Prisma.CommunityPostWhereInput {
  return {
    status: { in: [...managedPostStatuses] },
    topic: managedTopicWhere(),
  };
}

export function managedReplyWhere(requestedStatus?: string): Prisma.CommunityPostWhereInput {
  if (
    requestedStatus &&
    requestedStatus !== "all" &&
    !managedPostStatuses.includes(requestedStatus)
  ) {
    return { position: { gt: 1 }, status: { in: [] }, topic: managedTopicWhere() };
  }
  const status = managedPostStatuses.includes(requestedStatus ?? "") ? requestedStatus : undefined;
  return {
    ...managedPostWhere(),
    position: { gt: 1 },
    status: status ?? { in: [...managedPostStatuses] },
  };
}
