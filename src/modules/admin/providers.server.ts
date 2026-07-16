import "server-only";

import { getPrismaClient } from "@/infrastructure/database/client";
import { verifySmtpConnection } from "@/infrastructure/mail/smtp";
import { verifyObjectStorageConnection } from "@/infrastructure/storage/object-storage";
import { requireAdministrator } from "@/modules/admin/authorization.server";
import { AdminError } from "@/modules/admin/errors";
import { governanceActorRoles, writeGovernanceAudit } from "@/modules/moderation/governance.server";
import { getErrorMessage } from "@/shared/errors/error-message";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

export type ProviderName = "mail" | "storage" | "github";

function mask(value: string | undefined): string | null {
  if (!value) return null;
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}${"*".repeat(Math.min(value.length - 4, 8))}${value.slice(-2)}`;
}

function safeProviderError(error: unknown): string {
  const environment = getAuthEnvironment();
  let message = getErrorMessage(error);
  for (const value of [
    environment.SMTP_PASSWORD,
    environment.SMTP_USER,
    environment.S3_SECRET_ACCESS_KEY,
    environment.S3_ACCESS_KEY_ID,
    environment.GITHUB_CLIENT_SECRET,
    environment.GITHUB_CLIENT_ID,
  ]) {
    if (value) message = message.replaceAll(value, "[REDACTED]");
  }
  return message.slice(0, 300);
}

export function getProviderConfigurationStatus() {
  const environment = getAuthEnvironment();
  return {
    mail: {
      configured: Boolean(environment.SMTP_HOST),
      host: environment.SMTP_HOST ?? null,
      port: environment.SMTP_PORT,
      secure: environment.SMTP_SECURE,
      user: mask(environment.SMTP_USER),
      passwordConfigured: Boolean(environment.SMTP_PASSWORD),
      from: environment.SMTP_FROM,
    },
    storage: {
      configured:
        environment.STORAGE_DRIVER === "local" ||
        Boolean(
          environment.S3_BUCKET && environment.S3_ACCESS_KEY_ID && environment.S3_SECRET_ACCESS_KEY,
        ),
      driver: environment.STORAGE_DRIVER,
      localPath: environment.STORAGE_DRIVER === "local" ? environment.STORAGE_LOCAL_PATH : null,
      endpoint: environment.STORAGE_DRIVER === "s3" ? (environment.S3_ENDPOINT ?? null) : null,
      region: environment.STORAGE_DRIVER === "s3" ? (environment.S3_REGION ?? null) : null,
      bucket: environment.STORAGE_DRIVER === "s3" ? (environment.S3_BUCKET ?? null) : null,
      accessKey: environment.STORAGE_DRIVER === "s3" ? mask(environment.S3_ACCESS_KEY_ID) : null,
      secretConfigured: Boolean(environment.S3_SECRET_ACCESS_KEY),
    },
    github: {
      configured: Boolean(environment.GITHUB_CLIENT_ID && environment.GITHUB_CLIENT_SECRET),
      clientId: mask(environment.GITHUB_CLIENT_ID),
      secretConfigured: Boolean(environment.GITHUB_CLIENT_SECRET),
      callbackUrl: `${environment.APP_URL}/api/auth/callback/github`,
    },
  };
}

async function verifyGithubOAuth(): Promise<void> {
  const environment = getAuthEnvironment();
  if (!environment.GITHUB_CLIENT_ID || !environment.GITHUB_CLIENT_SECRET) {
    throw new AdminError("provider_unavailable", 503);
  }
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: environment.GITHUB_CLIENT_ID,
      client_secret: environment.GITHUB_CLIENT_SECRET,
      code: "nextbuf-connection-test-invalid-code",
    }),
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub OAuth returned HTTP ${response.status}`);
  const result = (await response.json()) as { error?: string };
  if (result.error !== "bad_verification_code") {
    throw new Error(result.error ?? "Unexpected GitHub OAuth response");
  }
}

export async function testProviderConnection(input: {
  actorId: string;
  provider: ProviderName;
  requestId: string;
}) {
  const prisma = getPrismaClient();
  const permissions = await prisma.$transaction((transaction) =>
    requireAdministrator(transaction, input.actorId),
  );
  let ok = false;
  let message = "连接成功";
  try {
    if (input.provider === "mail") await verifySmtpConnection();
    else if (input.provider === "storage") await verifyObjectStorageConnection();
    else await verifyGithubOAuth();
    ok = true;
  } catch (error) {
    message = safeProviderError(error);
  }
  const checkedAt = new Date();
  await prisma.$transaction((transaction) =>
    writeGovernanceAudit(transaction, {
      actorId: input.actorId,
      actorRoles: governanceActorRoles(permissions),
      action: "provider.connection.tested",
      targetType: "provider",
      targetKey: input.provider,
      reason: "管理员执行 Provider 连接测试",
      beforeState: { tested: false },
      afterState: { tested: true, ok },
      requestId: input.requestId,
    }),
  );
  return { ok, message, checkedAt };
}
