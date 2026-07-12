import "server-only";

import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  HOSTNAME: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TZ: z.string().min(1).default("Asia/Shanghai"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  LOG_FORMAT: z.enum(["pretty", "json"]).default("pretty"),
  NEXTBUF_VERSION: z.string().min(1).default("0.1.0"),
  NEXTBUF_COMMIT: z.string().min(1).default("development"),
  NEXTBUF_BUILD_TIME: z.string().default(""),
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  throw new Error(`Invalid environment configuration: ${z.prettifyError(parsedEnvironment.error)}`);
}

export const env = Object.freeze(parsedEnvironment.data);
