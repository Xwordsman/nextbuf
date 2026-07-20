export const EDITOR_AUTOSAVE_DELAY_MS = 1_500;
export const EDITOR_WRITE_TIMEOUT_MS = 15_000;
export const ATTACHMENT_UPLOAD_TIMEOUT_MS = 60_000;
export const EDITOR_RECOVERY_TIMEOUT_MS = 5_000;
export const EDITOR_RECOVERY_RETRY_MS = 400;
export const EDITOR_RECOVERY_ATTEMPTS = 4;
export const MAX_EDITOR_SESSION_REVISION = 2_147_483_647;
export const MAX_REPLY_EDITOR_SESSIONS_PER_HOUR = 60;
export const REPLY_EDITOR_SESSION_TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type EditorSession = {
  key: string;
  revision: number;
};
