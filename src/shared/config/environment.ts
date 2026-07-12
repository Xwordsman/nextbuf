import { z } from "zod";

const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.url().optional());

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  HOSTNAME: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TZ: z.string().min(1).default("Asia/Shanghai"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  NEXTBUF_VERSION: z.string().min(1).default("0.3.0"),
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

export type Environment = z.infer<typeof environmentSchema>;
export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;
export type RedisEnvironment = z.infer<typeof redisEnvironmentSchema>;
export type ServiceEnvironment = z.infer<typeof serviceEnvironmentSchema>;

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
