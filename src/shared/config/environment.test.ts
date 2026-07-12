import { describe, expect, it } from "vitest";
import {
  parseDatabaseEnvironment,
  parseAuthEnvironment,
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

  it("requires complete authentication, encryption and SMTP configuration", () => {
    const environment = parseAuthEnvironment({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://nextbuf:secret@localhost:5432/nextbuf",
      REDIS_URL: "redis://localhost:6379/0",
      AUTH_SECRET: "nextbuf-test-auth-secret-at-least-32-characters",
      MAIL_PAYLOAD_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      SMTP_HOST: "localhost",
    });

    expect(environment.AUTH_REGISTRATION_MODE).toBe("open");
    expect(environment.MAIL_PAYLOAD_KEY).toHaveLength(44);
  });

  it("rejects partial SMTP and OAuth credentials", () => {
    const input: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://nextbuf:secret@localhost:5432/nextbuf",
      REDIS_URL: "redis://localhost:6379/0",
      AUTH_SECRET: "nextbuf-test-auth-secret-at-least-32-characters",
      MAIL_PAYLOAD_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      SMTP_HOST: "localhost",
      SMTP_USER: "nextbuf",
      GITHUB_CLIENT_ID: "client-id",
    };

    expect(() => parseAuthEnvironment(input)).toThrow("SMTP_USER and SMTP_PASSWORD");
    expect(() => parseAuthEnvironment({ ...input, SMTP_PASSWORD: "secret" })).toThrow(
      "GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET",
    );
  });

  it("rejects development identity defaults in production", () => {
    expect(() =>
      parseAuthEnvironment({
        NODE_ENV: "production",
        APP_URL: "http://community.example.com",
        DATABASE_URL: "postgresql://nextbuf:secret@localhost:5432/nextbuf",
        REDIS_URL: "redis://localhost:6379/0",
        AUTH_SECRET: "replace-with-at-least-32-random-characters",
        MAIL_PAYLOAD_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        SMTP_HOST: "smtp.example.com",
      }),
    ).toThrow("must use https in production");
  });
});
