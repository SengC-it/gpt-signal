import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EntryEdgeFeatureName } from "./entry-edge.ts";
import type { R1AliasGroup, R1ScoreSpec } from "./entry-edge-r1.ts";

export const ENTRY_EDGE_R2_MIN_INNER_SAMPLE = 150;
export const ENTRY_EDGE_R2_MIN_INNER_SYMBOL_BREADTH = 3;
export const ENTRY_EDGE_R2_MIN_INNER_POSITIVE_FOLD_RATIO = 2 / 3;
export const ENTRY_EDGE_R2_MAX_INNER_MONOTONIC_VIOLATIONS = 2;

export type R2FeatureStatus = "INNER_OOS_ROBUST" | "WEAK" | "UNSTABLE" | "NO_EDGE";

export type R2FeatureDiagnostic = {
  feature: EntryEdgeFeatureName;
  status: R2FeatureStatus;
  sample: number;
  symbolBreadth: number;
  innerOosPositiveFolds: number;
  innerOosFolds: number;
  innerOosDirectionalLift: number;
  innerOosMonotonicViolations: number;
};

export type R2FinalModelDefinition = {
  modelVersion: "GPT-PROFIT-003-final-model-r2-v1";
  modelOrigin: "full_discovery";
  candidateId: string;
  setupFamily: string;
  selectedFeatures: EntryEdgeFeatureName[];
  aliasRemovals: R1AliasGroup[];
  scoreSpec: R1ScoreSpec;
  thresholds: Record<string, { rule: string; quantile: number; threshold: number }>;
  fitDataBoundary: { start: string; end: string; cutoff: string };
  labelAssumptions: Record<string, unknown>;
  candidateFreezeSha256: string;
  datasetManifestSha256: string;
  sourceCodeHashes: Record<string, string>;
};

export function classifyR2FeatureStatus(input: {
  sample: number;
  symbolBreadth: number;
  innerOosPositiveFolds: number;
  innerOosFolds: number;
  innerOosDirectionalLift: number;
  innerOosMonotonicViolations: number;
}): R2FeatureStatus {
  const positiveFoldRatio = input.innerOosFolds > 0
    ? input.innerOosPositiveFolds / input.innerOosFolds
    : 0;
  if (
    input.sample >= ENTRY_EDGE_R2_MIN_INNER_SAMPLE
    && input.symbolBreadth >= ENTRY_EDGE_R2_MIN_INNER_SYMBOL_BREADTH
    && positiveFoldRatio >= ENTRY_EDGE_R2_MIN_INNER_POSITIVE_FOLD_RATIO
    && input.innerOosDirectionalLift > 0
    && input.innerOosMonotonicViolations <= ENTRY_EDGE_R2_MAX_INNER_MONOTONIC_VIOLATIONS
  ) return "INNER_OOS_ROBUST";
  if (input.innerOosPositiveFolds > 0 && input.innerOosPositiveFolds < input.innerOosFolds) return "UNSTABLE";
  if (input.sample >= 50 && input.innerOosDirectionalLift > 0) return "WEAK";
  return "NO_EDGE";
}

export function selectR2Features(diagnostics: R2FeatureDiagnostic[], maximum = 8): EntryEdgeFeatureName[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.status === "INNER_OOS_ROBUST")
    .sort((left, right) => right.innerOosDirectionalLift - left.innerOosDirectionalLift || right.sample - left.sample || left.feature.localeCompare(right.feature))
    .slice(0, maximum)
    .map((diagnostic) => diagnostic.feature);
}

export function ensureR2CandidateFreeze(input: {
  freezePath: string;
  hashPath: string;
  definition: Record<string, unknown>;
}): { freeze: Record<string, unknown>; sha256: string; created: boolean } {
  fs.mkdirSync(path.dirname(input.freezePath), { recursive: true });
  const canonical = stableJson(input.definition);
  if (fs.existsSync(input.freezePath)) {
    const existing = JSON.parse(fs.readFileSync(input.freezePath, "utf8")) as Record<string, unknown>;
    if (stableJson(existing) !== canonical) throw new Error("GPT-PROFIT-003-R2 candidate freeze mismatch; refusing to overwrite existing freeze");
    const sha256 = hashR2File(input.freezePath);
    assertSidecar(input.hashPath, sha256, "R2 candidate freeze");
    return { freeze: existing, sha256, created: false };
  }
  fs.writeFileSync(input.freezePath, `${JSON.stringify(input.definition, null, 2)}\n`);
  const sha256 = hashR2File(input.freezePath);
  fs.writeFileSync(input.hashPath, `${sha256}  ${path.basename(input.freezePath)}\n`);
  return { freeze: input.definition, sha256, created: true };
}

export function ensureR2FinalModelFreeze(input: {
  modelPath: string;
  hashPath: string;
  definition: R2FinalModelDefinition;
}): { model: R2FinalModelDefinition; sha256: string; created: boolean } {
  fs.mkdirSync(path.dirname(input.modelPath), { recursive: true });
  const canonical = stableJson(input.definition);
  if (fs.existsSync(input.modelPath)) {
    const existing = JSON.parse(fs.readFileSync(input.modelPath, "utf8")) as R2FinalModelDefinition;
    if (stableJson(existing) !== canonical) throw new Error("GPT-PROFIT-003 final model freeze mismatch; refusing to overwrite existing model");
    const sha256 = hashR2File(input.modelPath);
    assertSidecar(input.hashPath, sha256, "final model freeze");
    return { model: existing, sha256, created: false };
  }
  fs.writeFileSync(input.modelPath, `${JSON.stringify(input.definition, null, 2)}\n`);
  const sha256 = hashR2File(input.modelPath);
  fs.writeFileSync(input.hashPath, `${sha256}  ${path.basename(input.modelPath)}\n`);
  return { model: input.definition, sha256, created: true };
}

export function assertR2FinalUnseenCanExecute(input: {
  candidateFreezeExists: boolean;
  candidateFreezeHashValid: boolean;
  internalGatePassed: boolean;
  selectedCandidateId: string | null;
  frozenCandidateIds: string[];
  finalModelExists: boolean;
  finalModelHashValid: boolean;
  finalModel: {
    modelOrigin: string;
    candidateId: string;
    setupFamily: string;
    fitDataBoundary: R2FinalModelDefinition["fitDataBoundary"];
    thresholds: R2FinalModelDefinition["thresholds"];
  } | null;
  discoveryCutoff: string;
  markerPath: string;
}): void {
  if (fs.existsSync(input.markerPath)) throw new Error("GPT-PROFIT-003 Final Unseen marker exists; refusing a second execution");
  if (!input.candidateFreezeExists || !input.candidateFreezeHashValid) throw new Error("R2 Final Unseen requires a valid candidate freeze");
  if (!input.internalGatePassed) throw new Error("R2 Final Unseen requires Internal OOS Gate PASS");
  if (!input.selectedCandidateId || !input.frozenCandidateIds.includes(input.selectedCandidateId)) throw new Error("R2 Final Unseen candidate is not from the frozen candidate set");
  if (!input.finalModelExists || !input.finalModelHashValid || !input.finalModel) throw new Error("R2 Final Unseen requires a valid Final Model Freeze");
  if (input.finalModel.modelOrigin !== "full_discovery") throw new Error("R2 Final Unseen refuses a non-full-discovery model");
  if (input.finalModel.candidateId !== input.selectedCandidateId) throw new Error("R2 Final Unseen candidate does not match the Final Model Freeze");
  if (input.finalModel.fitDataBoundary.cutoff !== input.discoveryCutoff) throw new Error("R2 Final Unseen Final Model Freeze cutoff mismatch");
  if (!Object.keys(input.finalModel.thresholds).length || Object.values(input.finalModel.thresholds).some((item) => !Number.isFinite(item.threshold))) throw new Error("R2 Final Unseen requires fixed Final Model thresholds");
}

export function hashR2File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertSidecar(hashPath: string, expected: string, label: string): void {
  if (!fs.existsSync(hashPath)) throw new Error(`GPT-PROFIT-003 ${label} SHA256 sidecar is missing; refusing to continue`);
  const sidecar = fs.readFileSync(hashPath, "utf8").trim().split(/\s+/)[0]?.toLowerCase();
  if (sidecar !== expected) throw new Error(`GPT-PROFIT-003 ${label} SHA256 mismatch; refusing to continue`);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
