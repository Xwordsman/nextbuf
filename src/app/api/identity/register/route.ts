import { z } from "zod";
import { getAuth, getInternalRegistrationHeader } from "@/infrastructure/auth/better-auth";
import { consumeIdentityRateLimit } from "@/infrastructure/auth/rate-limit";
import { getPrismaClient } from "@/infrastructure/database/client";
import { recordIdentityAudit } from "@/modules/identity/audit.server";
import {
  releaseRegistrationInvite,
  reserveRegistrationInvite,
} from "@/modules/identity/invites.server";
import { getAuthEnvironment } from "@/shared/config/runtime-env";
import { isUsernameAvailable } from "@/modules/profiles/username.server";
import { validateUsername } from "@/modules/profiles/username-policy";
import { getSiteSettings } from "@/modules/settings/settings.server";

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
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
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

export async function POST(request: Request): Promise<Response> {
  const input = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return errorResponse("invalid_registration", 400);

  const environment = getAuthEnvironment();
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
    if (invite) await releaseRegistrationInvite(invite.id);
    return acceptedResponse();
  }

  if (!(await isUsernameAvailable(username.username))) {
    if (invite) await releaseRegistrationInvite(invite.id);
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

    if (invite) {
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
    }
  } catch {
    if (invite) await releaseRegistrationInvite(invite.id);
    return acceptedResponse();
  }

  return acceptedResponse();
}
