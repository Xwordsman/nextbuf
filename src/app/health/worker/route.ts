import { NextResponse } from "next/server";
import { getWorkerHealthStatus } from "@/infrastructure/health/status";
import { PROJECT } from "@/shared/project";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const health = await getWorkerHealthStatus();

  return NextResponse.json(
    {
      status: health.ok ? "ok" : "unavailable",
      service: `${PROJECT.name} Worker`,
      version: PROJECT.version,
      timestamp: new Date().toISOString(),
      dependencies: health.dependencies,
      workers: health.workers,
      queue: health.queue,
    },
    {
      status: health.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
