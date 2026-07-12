import { describe, expect, it } from "vitest";
import { AppError } from "./app-error";

describe("AppError", () => {
  it("uses safe defaults for internal failures", () => {
    const error = new AppError({ code: "internal_error", message: "failed" });

    expect(error.name).toBe("AppError");
    expect(error.status).toBe(500);
    expect(error.expose).toBe(false);
  });
});
