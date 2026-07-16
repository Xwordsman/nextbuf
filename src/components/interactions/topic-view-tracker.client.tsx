"use client";

import { useEffect } from "react";

export function TopicViewTracker({
  topicNumber,
  lastVisiblePosition,
  markRead,
}: {
  topicNumber: number;
  lastVisiblePosition: number;
  markRead: boolean;
}) {
  useEffect(() => {
    void fetch(`/api/interactions/topics/${topicNumber}/view`, {
      method: "POST",
      keepalive: true,
    });
    if (markRead) {
      void fetch(`/api/interactions/topics/${topicNumber}/read`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position: lastVisiblePosition }),
        keepalive: true,
      });
    }
  }, [lastVisiblePosition, markRead, topicNumber]);
  return null;
}
