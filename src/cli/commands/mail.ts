import { z } from "zod";
import { disconnectPrismaClient } from "@/infrastructure/database/client";
import { queueTestEmail } from "@/infrastructure/mail/queue";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function mail(args: string[]): Promise<void> {
  const recipient = z.email().safeParse(option(args, "--to"));
  if (args[0] !== "test" || !recipient.success) {
    console.log("Usage: nextbuf mail test --to user@example.com");
    process.exitCode = 1;
    return;
  }
  await queueTestEmail(recipient.data);
  console.log(`Test email queued for ${recipient.data}.`);
  await disconnectPrismaClient();
}
