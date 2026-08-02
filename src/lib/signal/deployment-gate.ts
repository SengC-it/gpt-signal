export function assertDeploymentAllowed(report: unknown) {
  const value = report && typeof report === "object" ? report as Record<string, unknown> : {};
  const gate = value.gate && typeof value.gate === "object" ? value.gate as Record<string, unknown> : {};
  if (value.deploymentAllowed !== true || gate.passed !== true) {
    throw new Error("Deployment blocked: the validation report has not passed every profitability gate.");
  }
  return true;
}
