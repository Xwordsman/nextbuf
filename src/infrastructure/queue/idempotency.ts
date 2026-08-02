import { Prisma, type PrismaClient } from "@/generated/prisma/client";

type JobTransaction = Prisma.TransactionClient;

export async function runDatabaseJobOnce(
  prisma: PrismaClient,
  input: {
    queueName: string;
    jobName: string;
    idempotencyKey: string;
    onCompleted?: (transaction: JobTransaction) => Promise<void>;
  },
  action: (transaction: JobTransaction) => Promise<Prisma.InputJsonValue | undefined>,
): Promise<{ processed: boolean }> {
  try {
    return await prisma.$transaction(async (transaction) => {
      const existing = await transaction.processedJob.findUnique({
        where: {
          queueName_idempotencyKey: {
            queueName: input.queueName,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: { id: true },
      });

      if (existing) {
        await input.onCompleted?.(transaction);
        return { processed: false };
      }

      const result = await action(transaction);
      await input.onCompleted?.(transaction);
      await transaction.processedJob.create({
        data: {
          queueName: input.queueName,
          jobName: input.jobName,
          idempotencyKey: input.idempotencyKey,
          result,
        },
      });

      return { processed: true };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { processed: false };
    }

    throw error;
  }
}
