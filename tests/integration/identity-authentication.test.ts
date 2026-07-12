import type IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "@/cli/commands/setup";
import { POST as register } from "@/app/api/identity/register/route";
import { getAuth, getInternalRegistrationHeader } from "@/infrastructure/auth/better-auth";
import { disconnectRedisClient, getRedisClient } from "@/infrastructure/cache/redis";
import { disconnectPrismaClient, getPrismaClient } from "@/infrastructure/database/client";
import { decryptMailPayload } from "@/infrastructure/mail/encryption";
import { dispatchOutboxBatch } from "@/infrastructure/outbox/dispatcher";
import { closeSystemQueue } from "@/infrastructure/queue/system-queue";
import {
  createRegistrationInvite,
  releaseRegistrationInvite,
  reserveRegistrationInvite,
} from "@/modules/identity/invites.server";
import { createOutboxWorker } from "@/worker/processors/outbox";

const email = "identity-integration@nextbuf.test";
const oldPassword = "old-password-for-integration";
const newPassword = "new-password-for-integration";

async function waitFor(assertion: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

function request(path: string, body?: Record<string, unknown>, cookie?: string): Request {
  return new Request(`http://127.0.0.1:3000/api/auth${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      origin: "http://127.0.0.1:3000",
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
}

function sessionCookie(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("Authentication response did not set a session cookie");
  return value.split(";", 1)[0] ?? "";
}

function firstUrl(text: string): string {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error("Email payload did not contain an action URL");
  return match[0];
}

async function closeWorker(worker: ReturnType<typeof createOutboxWorker>): Promise<void> {
  await worker.worker.close();
  if (worker.connection.status !== "end") await worker.connection.quit();
}

describe("identity authentication integration", () => {
  let redis: IORedis;

  beforeAll(async () => {
    await setup();
    const prisma = getPrismaClient();
    redis = getRedisClient();
    await redis.flushdb();
    await prisma.processedJob.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.emailDelivery.deleteMany();
    await prisma.identityAuditEvent.deleteMany();
    await prisma.registrationInvite.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany({ where: { email } });
  });

  afterAll(async () => {
    await closeSystemQueue();
    await disconnectRedisClient();
    await disconnectPrismaClient();
  });

  it("enforces the NextBuf registration boundary", async () => {
    const response = await getAuth().handler(
      request("/sign-up/email", { name: "Boundary", email, password: oldPassword }),
    );
    expect(response.status).toBe(403);
    expect(await getPrismaClient().user.count({ where: { email } })).toBe(0);
  });

  it("registers, verifies and signs in with a stored scrypt credential", async () => {
    await getAuth().api.signUpEmail({
      body: {
        name: "Identity Test",
        email,
        password: oldPassword,
        callbackURL: "/auth/verified",
      },
      headers: new Headers({
        origin: "http://127.0.0.1:3000",
        "x-nextbuf-registration": getInternalRegistrationHeader(),
      }),
    });

    const prisma = getPrismaClient();
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const account = await prisma.account.findFirstOrThrow({
      where: { userId: user.id, providerId: "credential" },
    });
    expect(user).toMatchObject({ status: "pending", emailVerified: false });
    expect(account.password).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(account.password).not.toContain(oldPassword);

    const delivery = await prisma.emailDelivery.findFirstOrThrow({
      where: { recipient: email, kind: "email-verification" },
      orderBy: { createdAt: "desc" },
    });
    const verificationText = decryptMailPayload(delivery).text;
    if (!verificationText) throw new Error("Verification email did not contain text");
    const verificationUrl = firstUrl(verificationText);
    const verificationResponse = await getAuth().handler(
      new Request(verificationUrl, {
        headers: { origin: "http://127.0.0.1:3000" },
        redirect: "manual",
      }),
    );
    expect(verificationResponse.status).toBe(302);
    await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({
      status: "active",
      emailVerified: true,
    });

    const firstSignIn = await getAuth().handler(
      request("/sign-in/email", { email, password: oldPassword }),
    );
    const secondSignIn = await getAuth().handler(
      request("/sign-in/email", { email, password: oldPassword }),
    );
    expect(firstSignIn.status).toBe(200);
    expect(secondSignIn.status).toBe(200);
    expect(sessionCookie(firstSignIn)).toContain("nextbuf.session_token=");
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
  });

  it("does not disclose an existing account through the registration endpoint", async () => {
    const response = await register(
      new Request("http://127.0.0.1:3000/api/identity/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.20",
        },
        body: JSON.stringify({
          name: "Duplicate Identity Test",
          email,
          password: oldPassword,
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(await getPrismaClient().user.count({ where: { email } })).toBe(1);
  });

  it("hashes reset identifiers and revokes old sessions after password reset", async () => {
    const prisma = getPrismaClient();
    const resetRequest = await getAuth().handler(
      request("/request-password-reset", {
        email,
        redirectTo: "/auth/reset-password",
      }),
    );
    expect(resetRequest.status).toBe(200);

    const resetDelivery = await prisma.emailDelivery.findFirstOrThrow({
      where: { recipient: email, kind: "password-reset" },
      orderBy: { createdAt: "desc" },
    });
    const resetText = decryptMailPayload(resetDelivery).text;
    if (!resetText) throw new Error("Password reset email did not contain text");
    const resetUrl = new URL(firstUrl(resetText));
    const token = resetUrl.pathname.split("/").at(-1);
    if (!token) throw new Error("Reset URL did not contain a token");

    const stored = await prisma.verification.findFirstOrThrow({
      orderBy: { createdAt: "desc" },
    });
    expect(stored.identifier).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.identifier).not.toContain(token);

    const resetResponse = await getAuth().handler(
      request("/reset-password", { newPassword, token }),
    );
    expect(resetResponse.status).toBe(200);
    expect(await prisma.session.count({ where: { user: { email } } })).toBe(0);

    const oldSignIn = await getAuth().handler(
      request("/sign-in/email", { email, password: oldPassword }),
    );
    const newSignIn = await getAuth().handler(
      request("/sign-in/email", { email, password: newPassword }),
    );
    expect(oldSignIn.status).toBe(401);
    expect(newSignIn.status).toBe(200);
  });

  it("uses invites atomically and delivers queued identity email through the worker", async () => {
    const { code, invite } = await createRegistrationInvite({ maxUses: 1 });
    const reserved = await reserveRegistrationInvite(code);
    expect(reserved?.id).toBe(invite.id);
    await expect(reserveRegistrationInvite(code)).resolves.toBeNull();
    await releaseRegistrationInvite(invite.id);
    await expect(reserveRegistrationInvite(code)).resolves.toMatchObject({ id: invite.id });

    const worker = createOutboxWorker();
    await worker.worker.waitUntilReady();
    await dispatchOutboxBatch("identity-integration-dispatcher");
    await waitFor(async () => {
      return (
        (await getPrismaClient().emailDelivery.count({
          where: { recipient: email, status: "sent" },
        })) >= 1
      );
    });
    await closeWorker(worker);
  });
});
