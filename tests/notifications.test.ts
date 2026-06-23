import { describe, expect, test } from "vitest";
import { buildSignalEmail, buildSignalSummaryEmail } from "@/lib/notifications/templates";
import { sendEmail } from "@/lib/notifications/mailer";
import type { SignalEvaluation } from "@/lib/signal/types";

const signal: SignalEvaluation = {
  symbol: "SOLUSDT",
  direction: "LONG",
  signalType: "trend_pullback",
  lifecycleStatus: "planned",
  level: "A",
  score: 84,
  btcState: "weak_bull",
  marketRegime: "trend",
  dataQualityScore: 96,
  relativeStrengthScore: 3.8,
  reasons: ["价格比 BTC 更强", "数据质量 96"],
  invalidationRules: ["跌破关键支撑", "价格离建议位置太远"],
  noChaseRule: { noChasePrice: 116.2 },
  plan: {
    entryMode: "pullback_limit",
    entryLow: 102.8,
    entryHigh: 103.7,
    stopLoss: 98.4,
    tp1: 108.2,
    tp2: 113,
    tp3: 117.8,
    theoreticalRr: 3,
    weightedRr: 1.8,
    costAdjustedRr: 1.68,
    slDistancePct: 4.3,
    slAtrRatio: 1.4,
    noChasePrice: 116.2
  }
};

describe("notification templates", () => {
  test("uses plain language that explains the action and risk", () => {
    const email = buildSignalEmail(signal);

    expect(email.subject).toContain("SOLUSDT 关注做多机会");
    expect(email.body).toContain("这不是自动买入提醒");
    expect(email.body).toContain("建议观察价格区间");
    expect(email.body).toContain("如果价格已经超过");
    expect(email.body).not.toContain("生命周期状态");
    expect(email.body).not.toContain("market_regime");
  });

  test("skips sending when SMTP is not configured", async () => {
    const result = await sendEmail({ to: "", subject: "test", body: "hello" });

    expect(result.status).toBe("skipped");
  });

  test("builds one plain summary email ordered by score", () => {
    const ethSignal = { ...signal, symbol: "ETHUSDT", score: 89, level: "S" as const };
    const bnbSignal = { ...signal, symbol: "BNBUSDT", score: 81, level: "A" as const };
    const summary = buildSignalSummaryEmail([bnbSignal, signal, ethSignal]);

    expect(summary.subject).toContain("本轮 3 个机会");
    expect(summary.body).toContain("本轮共发现 3 个值得关注的机会");
    expect(summary.body.indexOf("ETHUSDT")).toBeLessThan(summary.body.indexOf("SOLUSDT"));
    expect(summary.body.indexOf("SOLUSDT")).toBeLessThan(summary.body.indexOf("BNBUSDT"));
    expect(summary.body).toContain("这不是自动买入提醒");
    expect(summary.body).not.toContain("market_regime");
  });
});
