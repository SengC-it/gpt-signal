import { describe, expect, test } from "vitest";
import { canSendNotifications } from "@/lib/signal/delivery";
import { assertDeploymentAllowed } from "@/lib/signal/deployment-gate";
import { evaluateValidationGate, summarizeValidationTrades } from "@/lib/signal/validation";

function trade(direction: "LONG" | "SHORT", netR: number, netPnlPct = netR) {
  return {
    direction,
    signalTime: Date.now(),
    finalStatus: netR >= 0 ? "hit_tp1" as const : "hit_sl" as const,
    entryHit: true,
    netR,
    grossR: netR,
    netPnlPct
  };
}

describe("validation gate", () => {
  test("requires positive OOS and holdout results with both directions", () => {
    const oosTrades = Array.from({ length: 100 }, (_, index) => trade(index % 2 ? "LONG" : "SHORT", 0.2, 0.1));
    const holdoutTrades = [trade("LONG", 0.5), trade("SHORT", -0.1)];
    const gate = evaluateValidationGate({
      coverageDays: 500,
      oos: summarizeValidationTrades(oosTrades),
      holdout: summarizeValidationTrades(holdoutTrades)
    });

    expect(gate.passed).toBe(true);
  });

  test("rejects a negative candidate even with enough trades", () => {
    const trades = Array.from({ length: 100 }, (_, index) => trade(index % 2 ? "LONG" : "SHORT", -0.1, -0.1));
    const summary = summarizeValidationTrades(trades);
    const gate = evaluateValidationGate({ coverageDays: 500, oos: summary, holdout: summary });

    expect(gate.passed).toBe(false);
    expect(gate.reasons).toContain("oosNetPnlPositive");
  });
});

describe("signal delivery mode", () => {
  test("shadow signals can never send notifications", () => {
    expect(canSendNotifications("shadow")).toBe(false);
    expect(canSendNotifications("production")).toBe(true);
  });
});

describe("deployment profitability gate", () => {
  test("blocks deployment when the gate is false", () => {
    expect(() => assertDeploymentAllowed({ deploymentAllowed: false, gate: { passed: false } })).toThrow();
  });

  test("allows deployment only when the report and gate both pass", () => {
    expect(assertDeploymentAllowed({ deploymentAllowed: true, gate: { passed: true } })).toBe(true);
  });
});
