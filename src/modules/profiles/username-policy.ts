const reservedUsernames = new Set([
  "account",
  "admin",
  "administrator",
  "api",
  "auth",
  "help",
  "login",
  "logout",
  "mail",
  "mod",
  "moderator",
  "nextbuf",
  "official",
  "postmaster",
  "privacy",
  "register",
  "root",
  "security",
  "settings",
  "signin",
  "signup",
  "status",
  "support",
  "system",
  "terms",
  "user",
  "users",
  "www",
]);

const usernamePattern = /^[a-z](?:[a-z0-9]|_(?=[a-z0-9])){2,23}$/;

export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsername(
  value: string,
): { ok: true; username: string } | { ok: false; code: "invalid_username" | "reserved_username" } {
  const username = normalizeUsername(value);
  if (!usernamePattern.test(username)) return { ok: false, code: "invalid_username" };
  if (reservedUsernames.has(username)) return { ok: false, code: "reserved_username" };
  return { ok: true, username };
}

export function usernameCooldownEnds(changedAt: Date): Date {
  return new Date(changedAt.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * 86_400_000);
}
