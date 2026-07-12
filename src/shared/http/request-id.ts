const REQUEST_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export function resolveRequestId(value: string | null | undefined): string {
  if (value && REQUEST_ID_PATTERN.test(value)) {
    return value;
  }

  return crypto.randomUUID();
}
