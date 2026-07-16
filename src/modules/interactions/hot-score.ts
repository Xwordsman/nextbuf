export const HOT_SIGNAL_CAPS = {
  replies: 40,
  participants: 15,
  likes: 80,
  bookmarks: 30,
  views: 500,
} as const;

export type HotScoreSignals = {
  publishedAt: Date;
  replyCount: number;
  participantCount: number;
  likeCount: number;
  bookmarkCount: number;
  viewCount: number;
};

function cappedLog(value: number, cap: number): number {
  return Math.log1p(Math.min(Math.max(value, 0), cap));
}

export function calculateHotScore(signals: HotScoreSignals, asOf = new Date()): number {
  const ageHours = Math.max(0, (asOf.getTime() - signals.publishedAt.getTime()) / 3_600_000);
  const engagement =
    1 +
    3 * cappedLog(signals.replyCount, HOT_SIGNAL_CAPS.replies) +
    4 * cappedLog(signals.participantCount, HOT_SIGNAL_CAPS.participants) +
    2 * cappedLog(signals.likeCount, HOT_SIGNAL_CAPS.likes) +
    1.5 * cappedLog(signals.bookmarkCount, HOT_SIGNAL_CAPS.bookmarks) +
    0.5 * cappedLog(signals.viewCount, HOT_SIGNAL_CAPS.views);

  return engagement / Math.pow(1 + ageHours / 24, 1.35);
}
