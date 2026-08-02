export const ACCOUNT_TOMBSTONE_EMAIL_DOMAIN = "deleted.invalid";
export const ACCOUNT_TOMBSTONE_USERNAME_PREFIX = "deleted-";

export function isAccountTombstoneEmail(value: string): boolean {
  const separator = value.lastIndexOf("@");
  if (separator < 0) return false;
  return (
    value
      .slice(separator + 1)
      .trim()
      .toLowerCase() === ACCOUNT_TOMBSTONE_EMAIL_DOMAIN
  );
}

export function isAccountTombstoneUsername(value: string): boolean {
  return value.trim().toLowerCase().startsWith(ACCOUNT_TOMBSTONE_USERNAME_PREFIX);
}
