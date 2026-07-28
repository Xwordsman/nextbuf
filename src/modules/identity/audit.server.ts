import "server-only";

import { createHmac } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import { getAuthEnvironment } from "@/shared/config/runtime-env";
import { resolveClientIp } from "@/shared/http/client-ip.server";

type IdentityAuditInput = {
  eventType: string;
  userId?: string;
  sessionId?: string;
  request?: Request;
  metadata?: Prisma.InputJsonObject;
};

function requestIpHash(request?: Request): string | undefined {
  const value = request ? resolveClientIp(request) : undefined;
  if (!value) return undefined;
  return createHmac("sha256", getAuthEnvironment().AUTH_SECRET).update(value).digest("hex");
}

export async function recordIdentityAudit(input: IdentityAuditInput): Promise<void> {
  await getPrismaClient().identityAuditEvent.create({
    data: {
      eventType: input.eventType,
      userId: input.userId,
      sessionId: input.sessionId,
      ipHash: requestIpHash(input.request),
      metadata: input.metadata,
    },
  });
}
