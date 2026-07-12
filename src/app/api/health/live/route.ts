import { NextResponse } from "next/server";
import { PROJECT } from "@/shared/project";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: PROJECT.name,
      version: PROJECT.version,
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
