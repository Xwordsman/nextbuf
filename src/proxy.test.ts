import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isInstallationComplete } from "@/modules/installation/status.server";
import { proxy } from "@/proxy";

vi.mock("@/modules/installation/status.server", () => ({
  isInstallationComplete: vi.fn(),
}));

const installationComplete = vi.mocked(isInstallationComplete);

describe("proxy installation routing", () => {
  beforeEach(() => {
    installationComplete.mockReset();
    installationComplete.mockResolvedValue(true);
  });

  it("redirects the first root request before rendering", async () => {
    installationComplete.mockResolvedValue(false);
    const response = await proxy(new NextRequest("https://community.example/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://community.example/setup");
  });

  it("does not query installation state for non-root routes", async () => {
    const response = await proxy(new NextRequest("https://community.example/setup"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(installationComplete).not.toHaveBeenCalled();
  });
});
