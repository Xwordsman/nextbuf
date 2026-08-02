import { describe, expect, it } from "vitest";
import {
  buildAdministratorContinuityAlert,
  evaluateAdministratorContinuity,
  getAdministratorContinuityDiagnosticState,
} from "@/modules/admin/continuity-policy";

describe("administrator continuity policy", () => {
  it("treats zero eligible administrators as a critical failure", () => {
    const status = evaluateAdministratorContinuity(0);

    expect(status).toMatchObject({ eligibleAdministrators: 0, state: "missing" });
    expect(buildAdministratorContinuityAlert(status)).toMatchObject({
      code: "administrator_continuity_missing",
      severity: "critical",
    });
    expect(getAdministratorContinuityDiagnosticState(status)).toEqual({
      ok: false,
      warning: false,
    });
  });

  it("warns when only one eligible administrator remains", () => {
    const status = evaluateAdministratorContinuity(1);

    expect(status).toMatchObject({ eligibleAdministrators: 1, state: "redundancy_warning" });
    expect(buildAdministratorContinuityAlert(status)).toMatchObject({
      code: "administrator_continuity_redundancy",
      severity: "warning",
    });
    expect(getAdministratorContinuityDiagnosticState(status)).toEqual({
      ok: true,
      warning: true,
    });
  });

  it("is healthy with at least two eligible administrators", () => {
    const status = evaluateAdministratorContinuity(2);

    expect(status).toMatchObject({ eligibleAdministrators: 2, state: "healthy" });
    expect(buildAdministratorContinuityAlert(status)).toBeNull();
    expect(getAdministratorContinuityDiagnosticState(status)).toEqual({
      ok: true,
      warning: false,
    });
  });

  it("rejects invalid administrator counts", () => {
    expect(() => evaluateAdministratorContinuity(-1)).toThrow(RangeError);
    expect(() => evaluateAdministratorContinuity(1.5)).toThrow(RangeError);
  });
});
