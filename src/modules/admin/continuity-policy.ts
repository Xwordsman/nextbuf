export type AdministratorContinuityState = "missing" | "redundancy_warning" | "healthy";

export type AdministratorContinuityStatus = {
  eligibleAdministrators: number;
  state: AdministratorContinuityState;
  message: string;
};

export type AdministratorContinuityAlert = {
  code: "administrator_continuity_missing" | "administrator_continuity_redundancy";
  severity: "critical" | "warning";
  message: string;
};

export type AdministratorContinuityDiagnosticState = {
  ok: boolean;
  warning: boolean;
};

const MISSING_MESSAGE =
  "没有可接管站点的管理员：请检查 admin/site 角色、账号状态、邮箱验证、注销申请、制裁和密码凭据。";
const REDUNDANCY_MESSAGE =
  "当前仅有 1 位可接管站点的管理员，建议再配置至少 1 位具备密码凭据的有效管理员。";
const HEALTHY_MESSAGE = "管理员连续性正常，至少有 2 位管理员可以接管站点。";

export function evaluateAdministratorContinuity(
  eligibleAdministrators: number,
): AdministratorContinuityStatus {
  if (!Number.isSafeInteger(eligibleAdministrators) || eligibleAdministrators < 0) {
    throw new RangeError("eligibleAdministrators must be a non-negative safe integer");
  }
  if (eligibleAdministrators === 0) {
    return { eligibleAdministrators, state: "missing", message: MISSING_MESSAGE };
  }
  if (eligibleAdministrators === 1) {
    return {
      eligibleAdministrators,
      state: "redundancy_warning",
      message: REDUNDANCY_MESSAGE,
    };
  }
  return { eligibleAdministrators, state: "healthy", message: HEALTHY_MESSAGE };
}

export function buildAdministratorContinuityAlert(
  status: AdministratorContinuityStatus,
): AdministratorContinuityAlert | null {
  if (status.state === "missing") {
    return {
      code: "administrator_continuity_missing",
      severity: "critical",
      message: status.message,
    };
  }
  if (status.state === "redundancy_warning") {
    return {
      code: "administrator_continuity_redundancy",
      severity: "warning",
      message: status.message,
    };
  }
  return null;
}

export function getAdministratorContinuityDiagnosticState(
  status: AdministratorContinuityStatus,
): AdministratorContinuityDiagnosticState {
  return {
    ok: status.state !== "missing",
    warning: status.state === "redundancy_warning",
  };
}
