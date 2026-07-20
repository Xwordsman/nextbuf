"use client";

import { MAX_EDITOR_SESSION_REVISION, type EditorSession } from "@/shared/community/editor-session";

const topicEditorHistoryKey = "nextbufTopicEditorSession";
const topicEditorHashPrefix = "#nextbuf-topic-editor-";
const replyEditorHistoryKey = "nextbufReplyEditorSession";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type TopicEditorHistorySession = EditorSession & { marker: string };
type ReplyEditorHistorySession = EditorSession & { topicNumber: number; path: string };

function currentHistoryState(): Record<string, unknown> {
  const current = window.history.state as unknown;
  return current && typeof current === "object" ? { ...(current as Record<string, unknown>) } : {};
}

function validEditorSession<T extends Partial<EditorSession>>(
  value: T | undefined,
): value is T & EditorSession {
  return (
    typeof value?.key === "string" &&
    uuidPattern.test(value.key) &&
    Number.isSafeInteger(value.revision) &&
    (value.revision ?? -1) >= 0 &&
    (value.revision ?? MAX_EDITOR_SESSION_REVISION + 1) <= MAX_EDITOR_SESSION_REVISION
  );
}

export function readTopicEditorSession(): EditorSession | null {
  try {
    const parsed = currentHistoryState()[topicEditorHistoryKey] as
      Partial<TopicEditorHistorySession> | undefined;
    if (
      validEditorSession(parsed) &&
      typeof parsed.marker === "string" &&
      uuidPattern.test(parsed.marker) &&
      window.location.hash === `${topicEditorHashPrefix}${parsed.marker}`
    ) {
      return { key: parsed.key, revision: parsed.revision };
    }
  } catch {
    // History state is an optional recovery aid; server-side idempotency remains authoritative.
  }
  return null;
}

export function writeTopicEditorSession(session: EditorSession): void {
  try {
    const state = currentHistoryState();
    const existing = state[topicEditorHistoryKey] as Partial<TopicEditorHistorySession> | undefined;
    const marker =
      existing?.key === session.key &&
      typeof existing.marker === "string" &&
      uuidPattern.test(existing.marker)
        ? existing.marker
        : globalThis.crypto.randomUUID();
    state[topicEditorHistoryKey] = { ...session, marker } satisfies TopicEditorHistorySession;
    const url = new URL(window.location.href);
    url.hash = `${topicEditorHashPrefix}${marker}`;
    window.history.replaceState(state, "", url);
  } catch {
    // The editor remains usable when History state is unavailable.
  }
}

export function clearTopicEditorSession(path?: string): boolean {
  try {
    const state = currentHistoryState();
    delete state[topicEditorHistoryKey];
    window.history.replaceState(state, "", path ?? window.location.href);
    return true;
  } catch {
    // The server-side key still prevents duplicate topics when History state is unavailable.
    return false;
  }
}

function currentReplyPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function readReplyEditorSession(topicNumber: number): EditorSession | null {
  try {
    const parsed = currentHistoryState()[replyEditorHistoryKey] as
      Partial<ReplyEditorHistorySession> | undefined;
    if (
      validEditorSession(parsed) &&
      parsed.topicNumber === topicNumber &&
      parsed.path === currentReplyPath()
    ) {
      return { key: parsed.key, revision: parsed.revision };
    }
  } catch {
    // History state is an optional recovery aid; server-side idempotency remains authoritative.
  }
  return null;
}

export function writeReplyEditorSession(topicNumber: number, session: EditorSession): void {
  try {
    const state = currentHistoryState();
    state[replyEditorHistoryKey] = {
      ...session,
      topicNumber,
      path: currentReplyPath(),
    } satisfies ReplyEditorHistorySession;
    window.history.replaceState(state, "", window.location.href);
  } catch {
    // The editor remains usable when History state is unavailable.
  }
}

export function clearReplyEditorSession(path?: string): boolean {
  try {
    const state = currentHistoryState();
    delete state[replyEditorHistoryKey];
    window.history.replaceState(state, "", path ?? window.location.href);
    return true;
  } catch {
    // The finalized server-side key remains authoritative.
    return false;
  }
}
