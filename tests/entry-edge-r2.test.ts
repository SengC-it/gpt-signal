import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ENTRY_EDGE_FEATURE_NAMES, type EntryEvent } from "@/lib/signal/entry-edge";
import { fitR1GrossScoreSpec } from "@/lib/signal/entry-edge-r1";
import {
  assertR2FinalUnseenCanExecute,
  classifyR2FeatureStatus,
  ensureR2CandidateFreeze,
  ensureR2FinalModelFreeze,
  selectR2Features,
  type R2FeatureDiagnostic,
  type R2FinalModelDefinition
} from "@/lib/signal/entry-edge-r2";
import {
  ALT_BASKET_DELIVERY_MODE,
  MAIN_STRATEGY_DELIVERY_MODE,
  PRODUCTION_SIGNAL_STRATEGIES
} from "@/lib/signal/profitability-config";

describe("GPT-PROFIT-003-R2 Inner OOS robustness", () => {
  test("Inner Test drives INNER_OOS_ROBUST status", () => {
    expect(classifyR2FeatureStatus({
      sample: 300,
      symbolBreadth: 6,
      innerOosPositiveFolds: 2,
      innerOosFolds: 3,
      innerOosDirectionalLift: 0.04,
      innerOosMonotonicViolations: 1
    })).toBe("INNER_OOS_ROBUST");
    expect(classifyR2FeatureStatus({
      sample: 300,
      symbolBreadth: 6,
      innerOosPositiveFolds: 1,
      innerOosFolds: 3,
      innerOosDirectionalLift: 0.04,
      innerOosMonotonicViolations: 1
    })).toBe("UNSTABLE");
  });

  test("changing Inner Test outcomes changes robustness selection", () => {
    const diagnostic = (): R2FeatureDiagnostic => ({
      feature: "trend_return_4h",
      status: "INNER_OOS_ROBUST",
      sample: 300,
      symbolBreadth: 6,
      innerOosPositiveFolds: 2,
      innerOosFolds: 3,
      innerOosDirectionalLift: 0.04,
      innerOosMonotonicViolations: 1
    });
    const robust = diagnostic();
    expect(selectR2Features([robust])).toEqual(["trend_return_4h"]);
    const changedInnerTest = { ...robust, status: classifyR2FeatureStatus({ ...robust, innerOosPositiveFolds: 1 }) };
    expect(selectR2Features([changedInnerTest])).toEqual([]);
  });

  test("Outer Test outcomes cannot change selected features", () => {
    const diagnostics: R2FeatureDiagnostic[] = [
      {
        feature: "trend_return_4h",
        status: "INNER_OOS_ROBUST",
        sample: 300,
        symbolBreadth: 6,
        innerOosPositiveFolds: 3,
        innerOosFolds: 3,
        innerOosDirectionalLift: 0.02,
        innerOosMonotonicViolations: 0
      },
      {
        feature: "trend_return_1h",
        status: "NO_EDGE",
        sample: 300,
        symbolBreadth: 6,
        innerOosPositiveFolds: 0,
        innerOosFolds: 3,
        innerOosDirectionalLift: -0.02,
        innerOosMonotonicViolations: 3
      }
    ];
    const selectedBefore = selectR2Features(diagnostics);
    const outerTestOutcomes = [-1, -1, -1, -1];
    outerTestOutcomes.fill(1);
    expect(selectR2Features(diagnostics)).toEqual(selectedBefore);
  });
});

describe("GPT-PROFIT-003-R2 Final Model Freeze", () => {
  test("R2 candidate freeze is immutable", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gpt003-r2-candidate-"));
    const freezePath = path.join(directory, "candidate.json");
    const hashPath = path.join(directory, "candidate.sha256");
    const definition = { freezeVersion: "r2", candidateIds: ["candidate-a"], innerOosRule: "2/3" };
    expect(ensureR2CandidateFreeze({ freezePath, hashPath, definition }).created).toBe(true);
    expect(ensureR2CandidateFreeze({ freezePath, hashPath, definition }).created).toBe(false);
    expect(() => ensureR2CandidateFreeze({ freezePath, hashPath, definition: { ...definition, innerOosRule: "1/3" } })).toThrow(/refusing to overwrite/);
  });

  test("Final Unseen requires a valid Final Model Freeze", () => {
    const markerPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gpt003-r2-guard-")), "marker.json");
    expect(() => assertR2FinalUnseenCanExecute({
      candidateFreezeExists: true,
      candidateFreezeHashValid: true,
      internalGatePassed: true,
      selectedCandidateId: "candidate-a",
      frozenCandidateIds: ["candidate-a"],
      finalModelExists: false,
      finalModelHashValid: false,
      finalModel: null,
      discoveryCutoff: "2026-08-02T03:15:00.000Z",
      markerPath
    })).toThrow(/Final Model Freeze/);
  });

  test("Final Model Freeze is immutable and hash sidecar is required", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gpt003-r2-model-"));
    const modelPath = path.join(directory, "model.json");
    const hashPath = path.join(directory, "model.sha256");
    const definition = finalModelDefinition();
    expect(ensureR2FinalModelFreeze({ modelPath, hashPath, definition }).created).toBe(true);
    expect(ensureR2FinalModelFreeze({ modelPath, hashPath, definition }).created).toBe(false);
    expect(() => ensureR2FinalModelFreeze({
      modelPath,
      hashPath,
      definition: { ...definition, thresholds: { trend_pullback_continuation: { ...definition.thresholds.trend_pullback_continuation, threshold: 61 } } }
    })).toThrow(/refusing to overwrite/);
    fs.unlinkSync(hashPath);
    expect(() => ensureR2FinalModelFreeze({ modelPath, hashPath, definition })).toThrow(/sidecar is missing/);
  });

  test("Final Unseen rejects last-outer-fold models and requires fixed thresholds", () => {
    const markerPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gpt003-r2-origin-")), "marker.json");
    const definition = finalModelDefinition();
    expect(() => assertR2FinalUnseenCanExecute({
      candidateFreezeExists: true,
      candidateFreezeHashValid: true,
      internalGatePassed: true,
      selectedCandidateId: definition.candidateId,
      frozenCandidateIds: [definition.candidateId],
      finalModelExists: true,
      finalModelHashValid: true,
      finalModel: { ...definition, modelOrigin: "outer_fold" },
      discoveryCutoff: definition.fitDataBoundary.cutoff,
      markerPath
    })).toThrow(/non-full-discovery/);
    expect(() => assertR2FinalUnseenCanExecute({
      candidateFreezeExists: true,
      candidateFreezeHashValid: true,
      internalGatePassed: true,
      selectedCandidateId: definition.candidateId,
      frozenCandidateIds: [definition.candidateId],
      finalModelExists: true,
      finalModelHashValid: false,
      finalModel: definition,
      discoveryCutoff: definition.fitDataBoundary.cutoff,
      markerPath
    })).toThrow(/valid Final Model Freeze/);
    expect(() => assertR2FinalUnseenCanExecute({
      candidateFreezeExists: true,
      candidateFreezeHashValid: true,
      internalGatePassed: true,
      selectedCandidateId: definition.candidateId,
      frozenCandidateIds: [definition.candidateId],
      finalModelExists: true,
      finalModelHashValid: true,
      finalModel: { ...definition, thresholds: { trend_pullback_continuation: { ...definition.thresholds.trend_pullback_continuation, threshold: Number.NaN } } },
      discoveryCutoff: definition.fitDataBoundary.cutoff,
      markerPath
    })).toThrow(/fixed Final Model thresholds/);
  });

  test("holdout remains single execution and gate cannot auto-run during R2", () => {
    const markerPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gpt003-r2-marker-")), "marker.json");
    fs.writeFileSync(markerPath, JSON.stringify({ executionCount: 1 }));
    const definition = finalModelDefinition();
    expect(() => assertR2FinalUnseenCanExecute({
      candidateFreezeExists: true,
      candidateFreezeHashValid: true,
      internalGatePassed: true,
      selectedCandidateId: definition.candidateId,
      frozenCandidateIds: [definition.candidateId],
      finalModelExists: true,
      finalModelHashValid: true,
      finalModel: definition,
      discoveryCutoff: definition.fitDataBoundary.cutoff,
      markerPath
    })).toThrow(/second execution/);
    expect(() => assertR2FinalUnseenCanExecute({
      candidateFreezeExists: true,
      candidateFreezeHashValid: true,
      internalGatePassed: false,
      selectedCandidateId: definition.candidateId,
      frozenCandidateIds: [definition.candidateId],
      finalModelExists: true,
      finalModelHashValid: true,
      finalModel: definition,
      discoveryCutoff: definition.fitDataBoundary.cutoff,
      markerPath: path.join(path.dirname(markerPath), "no-marker.json")
    })).toThrow(/Internal OOS Gate PASS/);
  });
});

describe("GPT-PROFIT-003-R2 safety", () => {
  test("production remains disabled", () => {
    expect(MAIN_STRATEGY_DELIVERY_MODE).toBe("shadow");
    expect(ALT_BASKET_DELIVERY_MODE).toBe("shadow");
    expect(PRODUCTION_SIGNAL_STRATEGIES).toEqual([]);
  });
});

function finalModelDefinition(): R2FinalModelDefinition {
  const event = sampleEvent();
  return {
    modelVersion: "GPT-PROFIT-003-final-model-r2-v1",
    modelOrigin: "full_discovery",
    candidateId: "candidate-a",
    setupFamily: "trend_pullback_continuation",
    selectedFeatures: ["trend_return_4h"],
    aliasRemovals: [],
    scoreSpec: fitR1GrossScoreSpec([event], ["trend_return_4h"]),
    thresholds: {
      trend_pullback_continuation: { rule: "top 30% within family, fitted on full discovery", quantile: 0.7, threshold: 60 }
    },
    fitDataBoundary: { start: "2025-05-09T23:45:00.000Z", end: "2026-08-02T03:15:00.000Z", cutoff: "2026-08-02T03:15:00.000Z" },
    labelAssumptions: { horizonBars: 96, sameCandlePriority: "STOP FIRST" },
    candidateFreezeSha256: "candidate-freeze-hash",
    datasetManifestSha256: "dataset-hash",
    sourceCodeHashes: { researchScript: "script-hash", r2Module: "module-hash" }
  };
}

function sampleEvent(): EntryEvent {
  const features = Object.fromEntries(ENTRY_EDGE_FEATURE_NAMES.map((name) => [name, 0])) as EntryEvent["features"];
  features.trend_return_4h = 1;
  const label = {
    targetR: 1 as const,
    status: "hit_tp" as const,
    entryTime: 0,
    exitTime: 1,
    grossR: 1,
    netR: 0.5,
    grossPnlPct: 1,
    netPnlPct: 0.5,
    mfe: 1,
    mae: 0,
    barsToOutcome: 1
  };
  return {
    eventId: "r2-model-event",
    symbol: "ETHUSDT",
    setupFamily: "trend_pullback_continuation",
    direction: "LONG",
    decisionIndex: 100,
    eventTime: 0,
    entryPrice: 100,
    stopLoss: 99,
    risk: 1,
    marketRegime: "bull",
    features,
    labelOneR: label,
    labelOne25R: { ...label, targetR: 1.25 }
  };
}
