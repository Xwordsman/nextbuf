import { z } from "zod";

const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.url().optional());
const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional(),
);
const exampleAuthSecret = "replace-with-at-least-32-random-characters";
const exampleMailPayloadKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopbackUrl(value: string): boolean {
  return loopbackHosts.has(new URL(value).hostname);
}

const base64Key = z.string().refine((value) => {
  try {
    return Buffer.from(value, "base64").byteLength === 32;
  } catch {
    return false;
  }
}, "must be a base64-encoded 32-byte key");

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  HOSTNAME: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TZ: z.string().min(1).default("Asia/Shanghai"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  NEXTBUF_VERSION: z.string().min(1).default("0.4.0"),
  NEXTBUF_COMMIT: z.string().min(1).default("development"),
  NEXTBUF_BUILD_TIME: z.string().default(""),
  DATABASE_URL: optionalUrl,
  DATABASE_DIRECT_URL: optionalUrl,
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),
  REDIS_URL: optionalUrl,
  REDIS_PREFIX: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, "must contain only letters, numbers, underscores or hyphens")
    .default("nextbuf"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(30_000),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1_000).default(10_000),
  WORKER_STALE_AFTER_MS: z.coerce.number().int().min(3_000).default(30_000),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  OUTBOX_LOCK_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(60_000),
  JOB_REMOVE_COMPLETE_AFTER: z.coerce.number().int().min(1).default(1_000),
  JOB_REMOVE_FAILED_AFTER: z.coerce.number().int().min(1).default(5_000),
  AUTH_SECRET: optionalString,
  AUTH_REGISTRATION_MODE: z.enum(["open", "invite", "closed"]).default("open"),
  AUTH_SESSION_EXPIRES_IN_SECONDS: z.coerce.number().int().min(3_600).default(2_592_000),
  AUTH_SESSION_UPDATE_AGE_SECONDS: z.coerce.number().int().min(60).default(86_400),
  AUTH_VERIFICATION_EXPIRES_IN_SECONDS: z.coerce.number().int().min(300).default(86_400),
  AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS: z.coerce.number().int().min(300).default(3_600),
  AUTH_TRUSTED_ORIGINS: z.string().default(""),
  AUTH_TRUSTED_PROXIES: z.string().default(""),
  MAIL_PAYLOAD_KEY: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1_025),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: z.string().min(3).default("NextBuf <noreply@localhost>"),
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,
});

const databaseEnvironmentSchema = environmentSchema.extend({
  DATABASE_URL: z
    .url()
    .refine((value) => ["postgresql:", "postgres:"].includes(new URL(value).protocol), {
      message: "must use the postgresql protocol",
    }),
});

const redisEnvironmentSchema = environmentSchema.extend({
  REDIS_URL: z.url().refine((value) => ["redis:", "rediss:"].includes(new URL(value).protocol), {
    message: "must use the redis or rediss protocol",
  }),
});

const serviceEnvironmentSchema = databaseEnvironmentSchema.and(redisEnvironmentSchema);

const authEnvironmentSchema = serviceEnvironmentSchema
  .and(
    z.object({
      AUTH_SECRET: z.string().min(32),
      MAIL_PAYLOAD_KEY: base64Key,
      SMTP_HOST: z.string().min(1),
    }),
  )
  .superRefine((environment, context) => {
    if (Boolean(environment.SMTP_USER) !== Boolean(environment.SMTP_PASSWORD)) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_USER"],
        message: "SMTP_USER and SMTP_PASSWORD must be configured together",
      });
    }

    if (Boolean(environment.GITHUB_CLIENT_ID) !== Boolean(environment.GITHUB_CLIENT_SECRET)) {
      context.addIssue({
        code: "custom",
        path: ["GITHUB_CLIENT_ID"],
        message: "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be configured together",
      });
    }

    if (environment.NODE_ENV === "production") {
      if (
        new URL(environment.APP_URL).protocol !== "https:" &&
        !isLoopbackUrl(environment.APP_URL)
      ) {
        context.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "must use https in production unless APP_URL is loopback",
        });
      }
      if (environment.AUTH_SECRET === exampleAuthSecret) {
        context.addIssue({
          code: "custom",
          path: ["AUTH_SECRET"],
          message: "must not use the example secret in production",
        });
      }
      if (environment.MAIL_PAYLOAD_KEY === exampleMailPayloadKey) {
        context.addIssue({
          code: "custom",
          path: ["MAIL_PAYLOAD_KEY"],
          message: "must not use the example key in production",
        });
      }
      if (environment.SMTP_FROM.includes("@localhost")) {
        context.addIssue({
          code: "custom",
          path: ["SMTP_FROM"],
          message: "must use a deliverable address in production",
        });
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;
export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;
export type RedisEnvironment = z.infer<typeof redisEnvironmentSchema>;
export type ServiceEnvironment = z.infer<typeof serviceEnvironmentSchema>;
export type AuthEnvironment = z.infer<typeof authEnvironmentSchema>;

function parse<T>(schema: z.ZodType<T>, input: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${z.prettifyError(result.error)}`);
  }

  return Object.freeze(result.data);
}

export function parseEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  return parse(environmentSchema, input);
}

export function parseServiceEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): ServiceEnvironment {
  return parse(serviceEnvironmentSchema, input);
}

export function parseDatabaseEnvironment(
  input: NodeJS.ProcessEnv = process.env,
): DatabaseEnvironment {
  return parse(databaseEnvironmentSchema, input);
}

export function parseRedisEnvironment(input: NodeJS.ProcessEnv = process.env): RedisEnvironment {
  return parse(redisEnvironmentSchema, input);
}

export function parseAuthEnvironment(input: NodeJS.ProcessEnv = process.env): AuthEnvironment {
  return parse(authEnvironmentSchema, input);
}
