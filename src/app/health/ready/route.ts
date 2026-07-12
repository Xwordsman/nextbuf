import { NextResponse } from "next/server";
import { getReadinessStatus } from "@/infrastructure/health/status";
import { PROJECT } from "@/shared/project";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const readiness = await getReadinessStatus();

  return NextResponse.json(
    {
      status: readiness.ok ? "ok" : "unavailable",
      service: PROJECT.name,
      version: PROJECT.version,
      timestamp: new Date().toISOString(),
      dependencies: readiness.dependencies,
    },
    {
      status: readiness.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
