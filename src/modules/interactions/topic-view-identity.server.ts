import "server-only";

import { createHmac } from "node:crypto";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

const topicViewHashDomain = "nextbuf-topic-view-v1";

export function hashTopicViewViewerKey(viewerKey: string, secret: string): string {
  return createHmac("sha256", secret).update(`${topicViewHashDomain}:${viewerKey}`).digest("hex");
}

export function getCurrentTopicViewViewerKeyHash(viewerKey: string): string {
  return hashTopicViewViewerKey(viewerKey, getAuthEnvironment().AUTH_SECRET);
}

export function getTopicViewUserKeyHashesForDeletion(userId: string): string[] {
  const environment = getAuthEnvironment();
  return [environment.AUTH_SECRET, ...environment.TOPIC_VIEW_PREVIOUS_AUTH_SECRETS].map((secret) =>
    hashTopicViewViewerKey(`user:${userId}`, secret),
  );
}
