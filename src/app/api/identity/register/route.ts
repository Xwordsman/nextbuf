import { z } from "zod";
import { getAuth, getInternalRegistrationHeader } from "@/infrastructure/auth/better-auth";
import { consumeIdentityRateLimit } from "@/infrastructure/auth/rate-limit";
import { getPrismaClient } from "@/infrastructure/database/client";
import { logger } from "@/infrastructure/observability/logger";
import { recordIdentityAudit } from "@/modules/identity/audit.server";
import {
  releaseRegistrationInvite,
  reserveRegistrationInvite,
} from "@/modules/identity/invites.server";
import { getAuthEnvironment } from "@/shared/config/runtime-env";
import { isUsernameAvailable } from "@/modules/profiles/username.server";
import { validateUsername } from "@/modules/profiles/username-policy";
import { getSiteSettings } from "@/modules/settings/settings.server";
import { getErrorMessage } from "@/shared/errors/error-message";
import { isInstallationComplete } from "@/modules/installation/status.server";
import { resolveClientIp } from "@/shared/http/client-ip.server";
import { hasSameOrigin } from "@/shared/http/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(40),
  username: z.string().trim().min(3).max(24),
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
  inviteCode: z.string().trim().max(200).optional(),
});

function clientAddress(request: Request): string {
  return resolveClientIp(request) ?? "unknown";
}

function errorResponse(code: string, status: number, retryAfter?: number): Response {
  return Response.json(
    { ok: false, code },
    {
      status,
      headers: retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
    },
  );
}

function acceptedResponse(): Response {
  return Response.json(
    { ok: true, message: "If registration is available, check your email." },
    { status: 202 },
  );
}

async function releaseInviteSafely(inviteId: string, reason: string): Promise<void> {
  try {
    await releaseRegistrationInvite(inviteId);
  } catch (error) {
    logger.error("Registration invite release failed", {
      inviteId,
      reason,
      error: getErrorMessage(error),
    });
  }
}

async function releaseInviteOnlyWhenRegistrationDidNotCommit(
  inviteId: string,
  email: string,
  registrationError: unknown,
): Promise<void> {
  try {
    const persistedUser = await getPrismaClient().user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (persistedUser) {
      // Better Auth can reject after its user transaction commits when a queued audit or mail hook
      // fails. Conservatively retain the reservation whenever durable registration is visible.
      logger.warn("Registration failed after durable user creation; invite reservation retained", {
        inviteId,
        userId: persistedUser.id,
        error: getErrorMessage(registrationError),
      });
      return;
    }
  } catch (error) {
    // An unavailable commit check is not proof that registration rolled back. Retaining one use is
    // safer than making a single-use invite reusable after an indeterminate commit.
    logger.error("Registration commit state could not be verified; invite reservation retained", {
      inviteId,
      registrationError: getErrorMessage(registrationError),
      error: getErrorMessage(error),
    });
    return;
  }

  await releaseInviteSafely(inviteId, "registration_not_committed");
}

export async function POST(request: Request): Promise<Response> {
  if (!hasSameOrigin(request)) return errorResponse("invalid_origin", 403);
  const input = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return errorResponse("invalid_registration", 400);

  const environment = getAuthEnvironment();
  if (!(await isInstallationComplete())) {
    return errorResponse("installation_incomplete", 503);
  }
  const settings = await getSiteSettings();
  const username = validateUsername(input.data.username);
  if (!username.ok) return errorResponse(username.code, 400);
  if (settings.registrationMode === "closed") {
    return errorResponse("registration_closed", 403);
  }

  const [ipLimit, emailLimit] = await Promise.all([
    consumeIdentityRateLimit("register-ip", clientAddress(request), 5, 3_600),
    consumeIdentityRateLimit("register-email", input.data.email, 3, 3_600),
  ]);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return errorResponse(
      "registration_rate_limited",
      429,
      Math.max(ipLimit.retryAfter, emailLimit.retryAfter),
    );
  }

  const existingUser = await getPrismaClient().user.findUnique({
    where: { email: input.data.email },
    select: { id: true },
  });
  let invite: Awaited<ReturnType<typeof reserveRegistrationInvite>> = null;

  if (settings.registrationMode === "invite") {
    if (!input.data.inviteCode) return errorResponse("invalid_invite", 403);
    invite = await reserveRegistrationInvite(input.data.inviteCode);
    if (!invite) return errorResponse("invalid_invite", 403);
  }

  if (existingUser) {
    if (invite) await releaseInviteSafely(invite.id, "existing_user");
    return acceptedResponse();
  }

  if (!(await isUsernameAvailable(username.username))) {
    if (invite) await releaseInviteSafely(invite.id, "username_unavailable");
    return errorResponse("username_unavailable", 409);
  }

  try {
    await getAuth().api.signUpEmail({
      body: {
        name: input.data.name,
        username: username.username,
        email: input.data.email,
        password: input.data.password,
        callbackURL: "/auth/verified",
      },
      headers: new Headers({
        origin: environment.APP_URL,
        "x-nextbuf-registration": getInternalRegistrationHeader(),
      }),
    });
  } catch (error) {
    if (invite) {
      await releaseInviteOnlyWhenRegistrationDidNotCommit(invite.id, input.data.email, error);
    }
    return acceptedResponse();
  }

  if (invite) {
    try {
      const user = await getPrismaClient().user.findUnique({
        where: { email: input.data.email },
        select: { id: true },
      });
      await recordIdentityAudit({
        eventType: "identity.invite.consumed",
        userId: user?.id,
        request,
        metadata: { inviteId: invite.id },
      });
    } catch (error) {
      // Registration has already committed. Never release a consumed invite here: doing so could
      // make a single-use code reusable. The public response remains intentionally non-enumerating.
      logger.error("Invite consumption audit failed after registration committed", {
        inviteId: invite.id,
        error: getErrorMessage(error),
      });
    }
  }

  return acceptedResponse();
}
