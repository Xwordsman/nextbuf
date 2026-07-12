import { createHmac } from "node:crypto";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import type { BetterAuthOptions } from "better-auth";
import type { DBAdapter, Where } from "better-auth/types";
import type { PrismaClient } from "@/generated/prisma/client";

export function hashVerificationIdentifier(secret: string, identifier: string): string {
  return createHmac("sha256", secret).update(identifier).digest("hex");
}

function secureWhere(
  model: string,
  secret: string,
  where: Where[] | undefined,
): Where[] | undefined {
  if (model !== "verification" || !where) return where;

  return where.map((condition) =>
    condition.field === "identifier" && typeof condition.value === "string"
      ? { ...condition, value: hashVerificationIdentifier(secret, condition.value) }
      : condition,
  );
}

function secureAdapter(adapter: DBAdapter, secret: string): DBAdapter {
  return {
    ...adapter,
    create: (input) =>
      adapter.create({
        ...input,
        data:
          input.model === "verification" && typeof input.data.identifier === "string"
            ? {
                ...input.data,
                identifier: hashVerificationIdentifier(secret, input.data.identifier),
              }
            : input.data,
      }),
    findOne: (input) =>
      adapter.findOne({ ...input, where: secureWhere(input.model, secret, input.where) ?? [] }),
    findMany: (input) =>
      adapter.findMany({ ...input, where: secureWhere(input.model, secret, input.where) }),
    count: (input) =>
      adapter.count({ ...input, where: secureWhere(input.model, secret, input.where) }),
    update: (input) =>
      adapter.update({ ...input, where: secureWhere(input.model, secret, input.where) ?? [] }),
    updateMany: (input) =>
      adapter.updateMany({ ...input, where: secureWhere(input.model, secret, input.where) ?? [] }),
    delete: (input) =>
      adapter.delete({ ...input, where: secureWhere(input.model, secret, input.where) ?? [] }),
    deleteMany: (input) =>
      adapter.deleteMany({ ...input, where: secureWhere(input.model, secret, input.where) ?? [] }),
    consumeOne: (input) =>
      adapter.consumeOne({ ...input, where: secureWhere(input.model, secret, input.where) ?? [] }),
    incrementOne: (input) =>
      adapter.incrementOne({
        ...input,
        where: secureWhere(input.model, secret, input.where) ?? [],
      }),
    transaction: (callback) =>
      adapter.transaction((transaction) => {
        const transactionalAdapter: DBAdapter = {
          ...transaction,
          transaction: async (nestedCallback) => nestedCallback(transaction),
        };
        return callback(secureAdapter(transactionalAdapter, secret));
      }),
  };
}

export function securePrismaAdapter(prisma: PrismaClient, secret: string) {
  const factory = prismaAdapter(prisma, {
    provider: "postgresql",
    transaction: true,
  });

  return (options: BetterAuthOptions) => secureAdapter(factory(options), secret);
}
