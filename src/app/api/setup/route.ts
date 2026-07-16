import { z } from "zod";
import {
  createInitialAdministrator,
  getInstallationStatus,
  InstallationError,
} from "@/modules/installation/installation.server";
import { resolveRequestId } from "@/shared/http/request-id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const setupSchema = z.object({
  token: z.string().min(32).max(512),
  name: z.string().trim().min(2).max(40),
  username: z.string().trim().min(3).max(24),
  email: z.email(),
  password: z.string().min(12).max(128),
});

export async function GET(): Promise<Response> {
  const status = await getInstallationStatus();
  return Response.json(status, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const input = setupSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ ok: false, code: "invalid_setup" }, { status: 400 });

  try {
    const administrator = await createInitialAdministrator({
      ...input.data,
      requestId: resolveRequestId(request.headers.get("x-request-id")),
    });
    return Response.json({ ok: true, administrator }, { status: 201 });
  } catch (error) {
    if (error instanceof InstallationError) {
      return Response.json({ ok: false, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
