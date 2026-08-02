import fs from "node:fs";
import path from "node:path";
import { assertDeploymentAllowed } from "../src/lib/signal/deployment-gate.ts";

const reportPath = process.argv[2] || process.env.VALIDATION_REPORT_PATH;
if (!reportPath) {
  console.error("Usage: npm run deploy:guarded -- <validation-report.json>");
  process.exitCode = 1;
} else {
  try {
    const report = JSON.parse(fs.readFileSync(path.resolve(reportPath), "utf8"));
    assertDeploymentAllowed(report);
    console.log(`Validation gate passed; deployment may proceed for ${report.walkForward?.finalHoldout?.selected?.main ?? "the approved candidate"}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
