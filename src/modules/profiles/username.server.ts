import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/infrastructure/database/client";
import {
  normalizeUsername,
  usernameCooldownEnds,
  validateUsername,
} from "@/modules/profiles/username-policy";

export class UsernameError extends Error {
  constructor(
    public readonly code:
      "invalid_username" | "reserved_username" | "username_unavailable" | "username_cooldown",
    public readonly availableAt?: Date,
  ) {
    super(code);
  }
}

export async function isUsernameAvailable(username: string, excludeUserId?: string) {
  const prisma = getPrismaClient();
  const [current, alias] = await Promise.all([
    prisma.user.findUnique({ where: { username }, select: { id: true } }),
    prisma.usernameAlias.findUnique({ where: { username }, select: { userId: true } }),
  ]);
  return (!current || current.id === excludeUserId) && (!alias || alias.userId === excludeUserId);
}

export async function generateAvailableUsername(seed: string): Promise<string> {
  let base = normalizeUsername(seed)
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(base)) base = `user_${base}`;
  if (base.length < 3) base = "user";
  base = base.slice(0, 15).replace(/_+$/g, "");

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `${base}_${randomUUID().replaceAll("-", "").slice(0, 6)}`.slice(0, 24);
    const validation = validateUsername(candidate);
    if (validation.ok && (await isUsernameAvailable(validation.username)))
      return validation.username;
  }
  throw new Error("Unable to allocate a unique username");
}

export async function changeUsername(userId: string, rawUsername: string) {
  const validation = validateUsername(rawUsername);
  if (!validation.ok) throw new UsernameError(validation.code);
  const username = validation.username;
  const prisma = getPrismaClient();

  try {
    return await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "users" WHERE "id" = CAST(${userId} AS uuid) FOR UPDATE`,
      );
      const user = await transaction.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.username === username) return user;

      if (user.usernameChangedAt) {
        const availableAt = usernameCooldownEnds(user.usernameChangedAt);
        if (availableAt > new Date()) throw new UsernameError("username_cooldown", availableAt);
      }

      const [currentOwner, aliasOwner] = await Promise.all([
        transaction.user.findUnique({ where: { username }, select: { id: true } }),
        transaction.usernameAlias.findUnique({ where: { username }, select: { userId: true } }),
      ]);
      if (currentOwner && currentOwner.id !== userId)
        throw new UsernameError("username_unavailable");
      if (aliasOwner && aliasOwner.userId !== userId)
        throw new UsernameError("username_unavailable");

      if (aliasOwner?.userId === userId) {
        await transaction.usernameAlias.delete({ where: { username } });
      }
      await transaction.usernameAlias.upsert({
        where: { username: user.username },
        create: { username: user.username, userId },
        update: {},
      });

      return transaction.user.update({
        where: { id: userId },
        data: { username, usernameChangedAt: new Date() },
      });
    });
  } catch (error) {
    if (error instanceof UsernameError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new UsernameError("username_unavailable");
    }
    throw error;
  }
}
