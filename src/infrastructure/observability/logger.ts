import { runtimeEnv } from "@/shared/config/runtime-env";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const redactedKeys =
  /authorization|cookie|password|secret|token|credential|database_?url|redis_?url|mail_?payload|email|ip_?address|payload|request_?body/i;
const connectionPassword = /\b((?:postgres(?:ql)?|redis(?:s)?):\/\/[^\s:/@]+:)[^\s/@]+@/giu;
const bearerToken = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/giu;
const headerSecret = /\b(cookie|set-cookie|authorization)\s*[:=]\s*[^\r\n]+/giu;

function redactString(value: string): string {
  return value
    .replace(connectionPassword, "$1[REDACTED]@")
    .replace(bearerToken, "$1 [REDACTED]")
    .replace(headerSecret, "$1: [REDACTED]");
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (depth >= 8) return "[TRUNCATED]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      redactedKeys.test(key) ? "[REDACTED]" : redactValue(nested, seen, depth + 1),
    ]),
  );
}

export function redactLogContext(context: LogContext): LogContext {
  return redactValue(context, new WeakSet(), 0) as LogContext;
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  if (levelPriority[level] < levelPriority[runtimeEnv.LOG_LEVEL]) {
    return;
  }

  const safeContext = redactLogContext(context);
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: redactString(message),
    ...safeContext,
  };

  if (runtimeEnv.LOG_FORMAT === "json") {
    console[level === "debug" ? "log" : level](JSON.stringify(entry));
    return;
  }

  console[level === "debug" ? "log" : level](
    `[${entry.timestamp}] ${level}: ${entry.message}`,
    safeContext,
  );
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
