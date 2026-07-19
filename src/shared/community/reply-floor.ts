function assertPostPosition(position: number): void {
  if (!Number.isSafeInteger(position) || position < 1) {
    throw new RangeError("Post position must be a positive safe integer.");
  }
}

export function replyFloorNumber(position: number): number {
  assertPostPosition(position);
  if (position === 1) {
    throw new RangeError("The topic's first post does not have a reply floor.");
  }
  return position - 1;
}

export function replyFloorLabel(position: number): string {
  return `#${replyFloorNumber(position)}`;
}

export function replyFloorPermalinkLabel(position: number): string {
  return `第 ${replyFloorNumber(position)} 楼永久链接`;
}

export function postReferenceLabel(position: number): string {
  assertPostPosition(position);
  return position === 1 ? "主题首帖" : replyFloorLabel(position);
}
