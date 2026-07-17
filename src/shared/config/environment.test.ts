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

  it("accepts a strong optional one-time setup token", () => {
    const environment = parseAuthEnvironment({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://nextbuf:secret@localhost:5432/nextbuf",
      REDIS_URL: "redis://localhost:6379/0",
      AUTH_SECRET: "nextbuf-test-auth-secret-at-least-32-characters",
      SETUP_TOKEN: "nextbuf-test-setup-token-at-least-32-characters",
      MAIL_PAYLOAD_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      SMTP_HOST: "localhost",
    });

    expect(environment.SETUP_TOKEN).toContain("setup-token");
    expect(() =>
      parseAuthEnvironment({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://nextbuf:secret@localhost:5432/nextbuf",
        REDIS_URL: "redis://localhost:6379/0",
        AUTH_SECRET: "nextbuf-test-auth-secret-at-least-32-characters",
        SETUP_TOKEN: "too-short",
        MAIL_PAYLOAD_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        SMTP_HOST: "localhost",
      }),
    ).toThrow("SETUP_TOKEN");
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

  it("requires a complete S3 storage configuration", () => {
    const input: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://nextbuf:secret@localhost:5432/nextbuf",
      REDIS_URL: "redis://localhost:6379/0",
      AUTH_SECRET: "nextbuf-test-auth-secret-at-least-32-characters",
      MAIL_PAYLOAD_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      SMTP_HOST: "localhost",
      STORAGE_DRIVER: "s3",
    };

    expect(() => parseAuthEnvironment(input)).toThrow(
      "S3_REGION is required when STORAGE_DRIVER=s3",
    );
  });

  it("accepts a complete S3 storage configuration", () => {
    const environment = parseAuthEnvironment({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://nextbuf:secret@localhost:5432/nextbuf",
      REDIS_URL: "redis://localhost:6379/0",
      AUTH_SECRET: "nextbuf-test-auth-secret-at-least-32-characters",
      MAIL_PAYLOAD_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      SMTP_HOST: "localhost",
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://objects.example.com",
      S3_REGION: "us-east-1",
      S3_BUCKET: "nextbuf-test",
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
      S3_FORCE_PATH_STYLE: "true",
    });

    expect(environment.STORAGE_DRIVER).toBe("s3");
    expect(environment.S3_BUCKET).toBe("nextbuf-test");
    expect(environment.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it("rejects unsafe operator-configured S3 endpoints", () => {
    const input: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://nextbuf:secret@localhost:5432/nextbuf",
      REDIS_URL: "redis://localhost:6379/0",
      AUTH_SECRET: "nextbuf-test-auth-secret-at-least-32-characters",
      MAIL_PAYLOAD_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      SMTP_HOST: "localhost",
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "ftp://user:secret@objects.example.com/bucket?redirect=internal",
      S3_REGION: "us-east-1",
      S3_BUCKET: "nextbuf-test",
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
    };

    expect(() => parseAuthEnvironment(input)).toThrow("S3_ENDPOINT must use http or https");
    expect(() =>
      parseAuthEnvironment({
        ...input,
        S3_ENDPOINT: "https://user:secret@objects.example.com?redirect=internal",
      }),
    ).toThrow("must not contain credentials");
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

  it("allows an HTTP loopback origin for standalone production tests", () => {
    const environment = parseAuthEnvironment({
      NODE_ENV: "production",
      APP_URL: "http://127.0.0.1:3000",
      DATABASE_URL: "postgresql://nextbuf:secret@localhost:5432/nextbuf",
      REDIS_URL: "redis://localhost:6379/0",
      AUTH_SECRET: "nextbuf-test-auth-secret-at-least-32-characters",
      MAIL_PAYLOAD_KEY: "SoxCSq6+35KG9qqH7JHtneowihiWs8hjtqqI37UhPQw=",
      SMTP_HOST: "localhost",
      SMTP_FROM: "NextBuf Test <noreply@nextbuf.test>",
    });

    expect(environment.APP_URL).toBe("http://127.0.0.1:3000");
  });
});
