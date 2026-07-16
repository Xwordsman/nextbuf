import { createHmac, timingSafeEqual } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { getPrismaClient } from "@/infrastructure/database/client";
import { authRateLimitStorage } from "@/infrastructure/auth/rate-limit";
import { securePrismaAdapter } from "@/infrastructure/auth/secure-prisma-adapter";
import { recordIdentityAudit } from "@/modules/identity/audit.server";
import { sendPasswordResetMessage, sendVerificationMessage } from "@/modules/identity/mail.server";
import { generateAvailableUsername } from "@/modules/profiles/username.server";
import { validateUsername } from "@/modules/profiles/username-policy";
import { getSiteSettings } from "@/modules/settings/settings.server";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function registrationHeader(secret: string): string {
  return createHmac("sha256", secret).update("nextbuf-internal-registration").digest("hex");
}

function headerMatches(expected: string, actual: string | null): boolean {
  if (!actual || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function getInternalRegistrationHeader(): string {
  return registrationHeader(getAuthEnvironment().AUTH_SECRET);
}

function createAuthInstance() {
  const environment = getAuthEnvironment();
  const github =
    environment.GITHUB_CLIENT_ID && environment.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: environment.GITHUB_CLIENT_ID,
            clientSecret: environment.GITHUB_CLIENT_SECRET,
            disableSignUp: false,
          },
        }
      : {};

  return betterAuth({
    appName: "NextBuf",
    baseURL: environment.APP_URL,
    basePath: "/api/auth",
    secret: environment.AUTH_SECRET,
    database: securePrismaAdapter(getPrismaClient(), environment.AUTH_SECRET),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: environment.AUTH_PASSWORD_RESET_EXPIRES_IN_SECONDS,
      sendResetPassword: async ({ user, url }) => sendPasswordResetMessage(user.email, url),
      onPasswordReset: async ({ user }, request) =>
        recordIdentityAudit({ eventType: "identity.password.reset", userId: user.id, request }),
    },
    emailVerification: {
      expiresIn: environment.AUTH_VERIFICATION_EXPIRES_IN_SECONDS,
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => sendVerificationMessage(user.email, url),
      afterEmailVerification: async (user, request) => {
        await getPrismaClient().user.update({
          where: { id: user.id },
          data: { status: "active", activatedAt: new Date() },
        });
        await recordIdentityAudit({
          eventType: "identity.email.verified",
          userId: user.id,
          request,
        });
      },
    },
    user: {
      additionalFields: {
        uid: { type: "number", required: false, input: false },
        username: { type: "string", required: false, input: true },
        status: { type: "string", required: true, input: false, defaultValue: "pending" },
        activatedAt: { type: "date", required: false, input: false },
        usernameChangedAt: { type: "date", required: false, input: false },
        deletionRequestedAt: { type: "date", required: false, input: false },
        deletionScheduledAt: { type: "date", required: false, input: false },
      },
    },
    session: {
      expiresIn: environment.AUTH_SESSION_EXPIRES_IN_SECONDS,
      updateAge: environment.AUTH_SESSION_UPDATE_AGE_SECONDS,
      freshAge: 3_600,
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, disableImplicitLinking: true },
    },
    socialProviders: github,
    trustedOrigins: [environment.APP_URL, ...splitList(environment.AUTH_TRUSTED_ORIGINS)],
    rateLimit: {
      enabled: true,
      customStorage: authRateLimitStorage,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/send-verification-email": { window: 600, max: 3 },
        "/request-password-reset": { window: 600, max: 3 },
        "/reset-password": { window: 600, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: new URL(environment.APP_URL).protocol === "https:",
      cookiePrefix: "nextbuf",
      database: { generateId: "uuid" },
      ipAddress: { trustedProxies: splitList(environment.AUTH_TRUSTED_PROXIES) },
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path !== "/sign-up/email") return;
        const expected = registrationHeader(environment.AUTH_SECRET);
        const actual =
          context.headers?.get("x-nextbuf-registration") ??
          context.request?.headers.get("x-nextbuf-registration") ??
          null;
        if (!headerMatches(expected, actual)) {
          throw new APIError("FORBIDDEN", {
            message: "Registration must use the NextBuf endpoint",
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const internalRegistration = headerMatches(
              registrationHeader(environment.AUTH_SECRET),
              context?.headers?.get("x-nextbuf-registration") ??
                context?.request?.headers.get("x-nextbuf-registration") ??
                null,
            );
            if (!internalRegistration) {
              const installation = await getPrismaClient().systemState.findUnique({
                where: { key: "installation.completed" },
                select: { key: true },
              });
              if (!installation) {
                throw new APIError("FORBIDDEN", { message: "Installation is not complete" });
              }
              if ((await getSiteSettings()).registrationMode !== "open") {
                throw new APIError("FORBIDDEN", { message: "Registration is not open" });
              }
            }
            const requested =
              typeof user.username === "string" ? validateUsername(user.username) : null;
            if (requested && !requested.ok) {
              throw new APIError("BAD_REQUEST", { message: requested.code });
            }
            const username = requested?.ok
              ? requested.username
              : await generateAvailableUsername(user.email.split("@", 1)[0] ?? "user");
            return {
              data: {
                ...user,
                username,
                ...(user.emailVerified ? { status: "active", activatedAt: new Date() } : {}),
              },
            };
          },
          after: async (user, context) => {
            await recordIdentityAudit({
              eventType: "identity.user.registered",
              userId: user.id,
              request: context?.request,
            });
          },
        },
      },
      session: {
        create: {
          after: async (session, context) =>
            recordIdentityAudit({
              eventType: "identity.session.created",
              userId: session.userId,
              sessionId: session.id,
              request: context?.request,
            }),
        },
        delete: {
          after: async (session, context) =>
            recordIdentityAudit({
              eventType: "identity.session.revoked",
              userId: session.userId,
              sessionId: session.id,
              request: context?.request,
            }),
        },
      },
    },
    telemetry: { enabled: false },
  });
}

let authInstance: ReturnType<typeof createAuthInstance> | undefined;

export function getAuth() {
  authInstance ??= createAuthInstance();
  return authInstance;
}
