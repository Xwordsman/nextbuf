import { createHmac, randomBytes } from "node:crypto";
import { getPrismaClient } from "@/infrastructure/database/client";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

function hashInvite(code: string): string {
  return createHmac("sha256", getAuthEnvironment().AUTH_SECRET).update(code).digest("hex");
}

export async function createRegistrationInvite(input: {
  label?: string;
  maxUses: number;
  expiresAt?: Date;
}) {
  const code = randomBytes(24).toString("base64url");
  const invite = await getPrismaClient().registrationInvite.create({
    data: {
      codeHash: hashInvite(code),
      label: input.label,
      maxUses: input.maxUses,
      expiresAt: input.expiresAt,
    },
  });

  return { code, invite };
}

export async function reserveRegistrationInvite(code: string) {
  const codeHash = hashInvite(code.trim());
  const result = await getPrismaClient().registrationInvite.updateMany({
    where: {
      codeHash,
      disabledAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      useCount: { lt: getPrismaClient().registrationInvite.fields.maxUses },
    },
    data: { useCount: { increment: 1 } },
  });

  if (result.count !== 1) return null;
  return getPrismaClient().registrationInvite.findUnique({ where: { codeHash } });
}

export async function releaseRegistrationInvite(inviteId: string): Promise<void> {
  await getPrismaClient().registrationInvite.updateMany({
    where: { id: inviteId, useCount: { gt: 0 } },
    data: { useCount: { decrement: 1 } },
  });
}
