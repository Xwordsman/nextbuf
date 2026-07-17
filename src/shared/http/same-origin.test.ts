import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSameOrigin } from "@/shared/http/same-origin";

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(target) : entry.name === "route.ts" ? [target] : [];
  });
}

describe("same-origin mutation policy", () => {
  it("only accepts the configured serialized origin", () => {
    const applicationUrl = "https://community.example.com";
    expect(
      isSameOrigin(
        new Request(`${applicationUrl}/api/test`, {
          headers: { origin: applicationUrl },
        }),
        applicationUrl,
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        new Request(`${applicationUrl}/api/test`, {
          headers: { origin: "https://community.example.com.evil.test" },
        }),
        applicationUrl,
      ),
    ).toBe(false);
    expect(
      isSameOrigin(
        new Request(`${applicationUrl}/api/test`, {
          headers: { origin: `${applicationUrl}/unexpected-path` },
        }),
        applicationUrl,
      ),
    ).toBe(false);
    expect(isSameOrigin(new Request(`${applicationUrl}/api/test`), applicationUrl)).toBe(false);
  });

  it("keeps every NextBuf mutation route behind the shared origin guard", () => {
    const apiRoot = path.join(process.cwd(), "src", "app", "api");
    const betterAuthRoute = path.join(apiRoot, "auth", "[...all]", "route.ts");
    const mutationPattern =
      /export\s+(?:(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)|\{[^}]*\bas\s+(?:POST|PUT|PATCH|DELETE))/s;
    const unguarded = routeFiles(apiRoot)
      .filter((file) => file !== betterAuthRoute)
      .filter((file) => mutationPattern.test(readFileSync(file, "utf8")))
      .filter((file) => !readFileSync(file, "utf8").includes("hasSameOrigin"))
      .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"));

    expect(unguarded).toEqual([]);
  });
});
