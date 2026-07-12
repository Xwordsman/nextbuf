import { runtimeEnv } from "@/shared/config/runtime-env";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const redactedKeys = /authorization|cookie|password|secret|token|database_url|redis_url/i;

function redact(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      redactedKeys.test(key) ? "[REDACTED]" : value,
    ]),
  );
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  if (levelPriority[level] < levelPriority[runtimeEnv.LOG_LEVEL]) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...redact(context),
  };

  if (runtimeEnv.LOG_FORMAT === "json") {
    console[level === "debug" ? "log" : level](JSON.stringify(entry));
    return;
  }

  console[level === "debug" ? "log" : level](
    `[${entry.timestamp}] ${level}: ${message}`,
    redact(context),
  );
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
};
