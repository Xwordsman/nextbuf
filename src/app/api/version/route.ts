import { NextResponse } from "next/server";
import { env } from "@/shared/config/env.server";
import { PROJECT } from "@/shared/project";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(
    {
      name: PROJECT.name,
      version: env.NEXTBUF_VERSION,
      commit: env.NEXTBUF_COMMIT,
      buildTime: env.NEXTBUF_BUILD_TIME || null,
      repository: PROJECT.repositoryUrl,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
