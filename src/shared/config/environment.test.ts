import { describe, expect, it } from "vitest";
import {
  parseDatabaseEnvironment,
  parseEnvironment,
  parseServiceEnvironment,
} from "@/shared/config/environment";

describe("environment configuration", () => {
  it("allows builds without service connections", () => {
    const environment = parseEnvironment({ NODE_ENV: "production" });

    expect(environment.DATABASE_URL).toBeUndefined();
    expect(environment.REDIS_URL).toBeUndefined();
  });

  it("requires PostgreSQL and Redis URLs for runtime services", () => {
    expect(() => parseServiceEnvironment({ NODE_ENV: "test" })).toThrow(
      "Invalid environment configuration",
    );
  });

  it("allows migrations to run without Redis", () => {
    const environment = parseDatabaseEnvironment({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://nextbuf:secret@localhost:5432/nextbuf",
    });

    expect(environment.DATABASE_URL).toContain("nextbuf");
  });

  it("separates the Redis namespace from connection details", () => {
    const environment = parseServiceEnvironment({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://nextbuf:secret@localhost:5432/nextbuf",
      REDIS_URL: "redis://localhost:6379/0",
      REDIS_PREFIX: "nextbuf_test",
    });

    expect(environment.REDIS_PREFIX).toBe("nextbuf_test");
  });
});
