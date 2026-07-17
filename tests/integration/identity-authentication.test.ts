import type IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setup } from "@/cli/commands/setup";
import { POST as updateAvatar } from "@/app/api/account/avatar/route";
import { POST as register } from "@/app/api/identity/register/route";
import { PATCH as updateProfile } from "@/app/api/account/profile/route";
import { PATCH as updatePrivacy } from "@/app/api/account/privacy/route";
import { PATCH as updateUsername } from "@/app/api/account/username/route";
import { POST as updateDeletion } from "@/app/api/account/deletion/route";
import { GET as readAvatar } from "@/app/api/media/avatars/[key]/route";
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
import { resolvePublicProfile } from "@/modules/profiles/profile.server";
import { createOutboxWorker } from "@/worker/processors/outbox";

const emailPrefix = "identity-integration+";
const emailDomain = "@nextbuf.test";
const oldPassword = "old-password-for-integration";
const newPassword = "new-password-for-integration";

function testEmail(scenario: string): string {
  return `${emailPrefix}${scenario}${emailDomain}`;
}

async function waitFor(assertion: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
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

async function registerPendingUser(email: string) {
  const scenario = email.slice(emailPrefix.length, -emailDomain.length).replaceAll("-", "_");
  const username = `id_${scenario}`.slice(0, 24);
  await getAuth().api.signUpEmail({
    body: {
      name: "Identity Test",
      username,
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
  const delivery = await prisma.emailDelivery.findFirstOrThrow({
    where: { recipient: email, kind: "email-verification" },
    orderBy: { createdAt: "desc" },
  });

  return { user, account, delivery, username };
}

function accountRequest(
  path: string,
  method: "PATCH" | "POST",
  body: Record<string, unknown>,
  cookie: string,
) {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method,
    headers: {
      cookie,
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function avatarRequest(cookie: string, marker: number) {
  const form = new FormData();
  form.set(
    "avatar",
    new File(
      [
        new Uint8Array([
          0x52,
          0x49,
          0x46,
          0x46,
          8 + marker,
          0,
          0,
          0,
          0x57,
          0x45,
          0x42,
          0x50,
          0x56,
          0x50,
          0x38,
          0x4c,
        ]),
      ],
      "avatar.webp",
      { type: "image/webp" },
    ),
  );
  return new Request("http://127.0.0.1:3000/api/account/avatar", {
    method: "POST",
    headers: { cookie, origin: "http://127.0.0.1:3000" },
    body: form,
  });
}

async function verifyUser(
  email: string,
  delivery: Awaited<ReturnType<typeof registerPendingUser>>["delivery"],
) {
  const verificationText = decryptMailPayload(delivery).text;
  if (!verificationText) throw new Error("Verification email did not contain text");

  const response = await getAuth().handler(
    new Request(firstUrl(verificationText), {
      headers: { origin: "http://127.0.0.1:3000" },
      redirect: "manual",
    }),
  );

  expect(response.status).toBe(302);
  return getPrismaClient().user.findUniqueOrThrow({ where: { email } });
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
    await prisma.emailDelivery.deleteMany({
      where: { recipient: { startsWith: emailPrefix, endsWith: emailDomain } },
    });
    await prisma.identityAuditEvent.deleteMany();
    await prisma.registrationInvite.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany({
      where: { email: { startsWith: emailPrefix, endsWith: emailDomain } },
    });
    await prisma.systemState.upsert({
      where: { key: "installation.completed" },
      create: { key: "installation.completed", value: { source: "integration-test" } },
      update: { value: { source: "integration-test" } },
    });
  });

  afterAll(async () => {
    await closeSystemQueue();
    await disconnectRedisClient();
    await disconnectPrismaClient();
  });

  it("enforces the NextBuf registration boundary", async () => {
    const email = testEmail("boundary");
    const response = await getAuth().handler(
      request("/sign-up/email", { name: "Boundary", email, password: oldPassword }),
    );
    expect(response.status).toBe(403);
    expect(await getPrismaClient().user.count({ where: { email } })).toBe(0);
  });

  it("registers, verifies and signs in with a stored scrypt credential", async () => {
    const email = testEmail("registration");
    const { user, account, delivery } = await registerPendingUser(email);
    expect(user).toMatchObject({ status: "pending", emailVerified: false });
    expect(account.password).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(account.password).not.toContain(oldPassword);

    await expect(verifyUser(email, delivery)).resolves.toMatchObject({
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
    expect(await getPrismaClient().session.count({ where: { userId: user.id } })).toBe(2);
  });

  it("does not disclose an existing account through the registration endpoint", async () => {
    const email = testEmail("duplicate");
    await registerPendingUser(email);

    const response = await register(
      new Request("http://127.0.0.1:3000/api/identity/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3000",
          "x-forwarded-for": "192.0.2.20",
        },
        body: JSON.stringify({
          name: "Duplicate Identity Test",
          username: "duplicate_identity",
          email,
          password: oldPassword,
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(await getPrismaClient().user.count({ where: { email } })).toBe(1);
  });

  it("creates durable identity profiles and enforces username history", async () => {
    await redis.flushdb();
    const email = testEmail("profile-api");
    const { user, delivery, username } = await registerPendingUser(email);
    expect(user.uid).toBeGreaterThanOrEqual(1000);
    expect(user.username).toBe(username);
    await expect(resolvePublicProfile(username)).resolves.toBeNull();
    await expect(
      getPrismaClient().profile.findUnique({ where: { userId: user.id } }),
    ).resolves.toBeTruthy();
    await verifyUser(email, delivery);
    await expect(resolvePublicProfile(username)).resolves.toMatchObject({
      user: { id: user.id },
      redirected: false,
    });

    const signIn = await getAuth().handler(
      request("/sign-in/email", { email, password: oldPassword }),
    );
    const cookie = sessionCookie(signIn);

    await expect(
      updateProfile(
        accountRequest(
          "/api/account/profile",
          "PATCH",
          { name: "Profile Test", bio: "Durable profile", website: "https://example.com" },
          cookie,
        ),
      ),
    ).resolves.toMatchObject({ status: 200 });

    await expect(
      updateUsername(
        accountRequest("/api/account/username", "PATCH", { username: "profile_changed" }, cookie),
      ),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      getPrismaClient().usernameAlias.findUnique({ where: { username } }),
    ).resolves.toMatchObject({
      userId: user.id,
    });
    const aliasClaimEmail = testEmail("profile-alias-claim");
    await expect(
      getAuth().api.signUpEmail({
        body: {
          name: "Alias Claim Test",
          username,
          email: aliasClaimEmail,
          password: oldPassword,
          callbackURL: "/auth/verified",
        },
        headers: new Headers({
          origin: "http://127.0.0.1:3000",
          "x-nextbuf-registration": getInternalRegistrationHeader(),
        }),
      }),
    ).rejects.toBeTruthy();
    await expect(getPrismaClient().user.count({ where: { email: aliasClaimEmail } })).resolves.toBe(
      0,
    );
    const cooldown = await updateUsername(
      accountRequest("/api/account/username", "PATCH", { username: "profile_again" }, cookie),
    );
    expect(cooldown.status).toBe(429);

    const firstAvatar = await updateAvatar(avatarRequest(cookie, 1));
    expect(firstAvatar.status).toBe(200);
    const firstImage = String((await firstAvatar.json()).image);
    const firstKey = firstImage.split("/").at(-1);
    if (!firstKey) throw new Error("Avatar response did not contain a media key");
    await expect(
      readAvatar(new Request(`http://127.0.0.1:3000${firstImage}`), {
        params: Promise.resolve({ key: firstKey }),
      }),
    ).resolves.toMatchObject({ status: 200 });

    const secondAvatar = await updateAvatar(avatarRequest(cookie, 2));
    expect(secondAvatar.status).toBe(200);
    await expect(
      readAvatar(new Request(`http://127.0.0.1:3000${firstImage}`), {
        params: Promise.resolve({ key: firstKey }),
      }),
    ).resolves.toMatchObject({ status: 404 });

    await expect(
      updatePrivacy(
        accountRequest(
          "/api/account/privacy",
          "PATCH",
          { isPublic: false, showActivity: false },
          cookie,
        ),
      ),
    ).resolves.toMatchObject({ status: 200 });
    const deletion = await updateDeletion(
      accountRequest("/api/account/deletion", "POST", { action: "request" }, cookie),
    );
    expect(deletion.status).toBe(200);
    const deletionBody = (await deletion.json()) as { scheduledAt: string };
    const repeatedDeletion = await updateDeletion(
      accountRequest("/api/account/deletion", "POST", { action: "request" }, cookie),
    );
    await expect(repeatedDeletion.json()).resolves.toMatchObject({
      scheduledAt: deletionBody.scheduledAt,
    });
    await expect(
      getPrismaClient().user.findUniqueOrThrow({ where: { id: user.id } }),
    ).resolves.toMatchObject({ deletionRequestedAt: expect.any(Date) });
    await expect(
      updateDeletion(accountRequest("/api/account/deletion", "POST", { action: "cancel" }, cookie)),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("hashes reset identifiers and revokes old sessions after password reset", async () => {
    await redis.flushdb();
    const email = testEmail("password-reset");
    const { delivery } = await registerPendingUser(email);
    await verifyUser(email, delivery);

    const firstSignIn = await getAuth().handler(
      request("/sign-in/email", { email, password: oldPassword }),
    );
    const secondSignIn = await getAuth().handler(
      request("/sign-in/email", { email, password: oldPassword }),
    );
    expect(firstSignIn.status).toBe(200);
    expect(secondSignIn.status).toBe(200);

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

    const prisma = getPrismaClient();
    await prisma.processedJob.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.emailDelivery.deleteMany();

    const email = testEmail("worker");
    const { delivery } = await registerPendingUser(email);
    const worker = createOutboxWorker();
    let workerFailure: Error | undefined;
    worker.worker.on("failed", (_job, error) => {
      workerFailure = error;
    });

    try {
      await worker.worker.waitUntilReady();
      await expect(dispatchOutboxBatch("identity-integration-dispatcher")).resolves.toEqual({
        dispatched: 1,
        failed: 0,
      });
      await waitFor(async () => {
        if (workerFailure) throw workerFailure;
        const current = await prisma.emailDelivery.findUnique({ where: { id: delivery.id } });
        return current?.status === "sent";
      });
    } catch (error) {
      const [currentDelivery, currentOutbox] = await Promise.all([
        prisma.emailDelivery.findUnique({ where: { id: delivery.id } }),
        prisma.outboxEvent.findFirst({
          where: { payload: { path: ["deliveryId"], equals: delivery.id } },
        }),
      ]);
      throw new Error(
        `Identity email worker failed: ${JSON.stringify({
          cause: error instanceof Error ? error.message : String(error),
          delivery: currentDelivery && {
            status: currentDelivery.status,
            attempts: currentDelivery.attempts,
            lastError: currentDelivery.lastError,
          },
          outbox: currentOutbox && {
            attempts: currentOutbox.attempts,
            lastError: currentOutbox.lastError,
            publishedAt: currentOutbox.publishedAt,
          },
        })}`,
      );
    } finally {
      await closeWorker(worker);
    }
  });
});
