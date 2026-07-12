import { disconnectPrismaClient } from "@/infrastructure/database/client";
import { createRegistrationInvite } from "@/modules/identity/invites.server";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export async function invite(args: string[]): Promise<void> {
  if (args[0] !== "create") {
    console.log("Usage: nextbuf invite create [--uses 1] [--expires-hours 168] [--label text]");
    process.exitCode = 1;
    return;
  }

  const maxUses = positiveInteger(option(args, "--uses"), 1, "--uses");
  const expiresHours = positiveInteger(option(args, "--expires-hours"), 168, "--expires-hours");
  const label = option(args, "--label")?.trim() || undefined;
  const { code, invite: created } = await createRegistrationInvite({
    label,
    maxUses,
    expiresAt: new Date(Date.now() + expiresHours * 60 * 60 * 1_000),
  });

  console.log(`Invite ID: ${created.id}`);
  console.log(`Invite code (shown once): ${code}`);
  console.log(`Maximum uses: ${created.maxUses}`);
  console.log(`Expires at: ${created.expiresAt?.toISOString() ?? "never"}`);
  await disconnectPrismaClient();
}
