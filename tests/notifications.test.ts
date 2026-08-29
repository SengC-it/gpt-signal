import { describe, expect, test } from "vitest";
import { buildAltBasketSummaryEmail, buildSignalEmail, buildSignalSummaryEmail } from "@/lib/notifications/templates";
import { formatEmailMessage, resolveEmailSender, sendEmail } from "@/lib/notifications/mailer";
import { filterStrongAlertSignals, shouldRunStrongAlertWindow, shouldSendStrongAlert } from "@/lib/notifications/policy";
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
  test("builds a strict BTC weak alt-basket short email", () => {
    const basketSignal: SignalEvaluation = {
      ...signal,
      symbol: "ALT_SHORT_BASKET",
      direction: "SHORT",
      signalType: "alt_basket_short",
      score: 91,
      noChaseRule: {
        basketSymbols: "ETHUSDT,SOLUSDT,BNBUSDT,LINKUSDT,AVAXUSDT,DOGEUSDT",
        weights: "ETHUSDT:16.67%,SOLUSDT:16.67%",
        entryPrices: "ETHUSDT:2500,SOLUSDT:150",
        btc4hClose: 60000,
        btcSma50: 62000,
        takeProfitPct: 6,
        stopLossPct: 5,
        expectedFundingCostPct: 0.2
      },
      plan: {
        entryMode: "confirmation_wait",
        entryLow: 100,
        entryHigh: 100,
        stopLoss: 105,
        tp1: 94,
        tp2: 94,
        tp3: 94,
        theoreticalRr: 1.2,
        weightedRr: 1.2,
        costAdjustedRr: 1.164,
        slDistancePct: 5,
        slAtrRatio: 0,
        noChasePrice: 105
      }
    };

    const email = buildSignalEmail(basketSignal);

    expect(email.subject).toContain("做空计划｜6 个币");
    expect(email.subject).toContain("每币止盈 6% / 止损 5%");
    expect(email.body).toContain("ETHUSDT：入场 2500｜止盈 2350｜止损 2625");
    expect(email.body).toContain("下一根 15 分钟 K 线开盘附近");
    expect(email.body).toContain("某个币先碰到止盈或止损，只平掉这个币");
    expect(email.body).toContain("BTC 4 小时收盘重新站上 SMA50");
  });

  test("builds one simple basket email with an executable row for every pair", () => {
    const eth = {
      ...signal,
      symbol: "ETHUSDT",
      direction: "SHORT" as const,
      signalType: "alt_basket_short" as const,
      noChaseRule: { takeProfitPct: 6, stopLossPct: 5, btc4hClose: 60000, btcSma50: 62000, weightPct: 50 },
      plan: { ...signal.plan!, entryLow: 2500, entryHigh: 2500, tp1: 2350, tp2: 2350, tp3: 2350, stopLoss: 2625 }
    };
    const sol = {
      ...eth,
      symbol: "SOLUSDT",
      noChaseRule: { ...eth.noChaseRule, weightPct: 50 },
      plan: { ...eth.plan, entryLow: 150, entryHigh: 150, tp1: 141, tp2: 141, tp3: 141, stopLoss: 157.5 }
    };

    const email = buildAltBasketSummaryEmail([eth, sol]);

    expect(email.subject).toContain("做空计划｜2 个币");
    expect(email.body).toContain("ETHUSDT：卖出/做空｜入场 2500｜止盈 2350｜止损 2625");
    expect(email.body).toContain("SOLUSDT：卖出/做空｜入场 150｜止盈 141｜止损 157.5");
    expect(email.body).toContain("止盈 = 成交价 × 0.94；止损 = 成交价 × 1.05");
  });

  test("uses plain language that explains the action and risk", () => {
    const email = buildSignalEmail(signal);

    expect(email.subject).toContain("做多上涨提醒");
    expect(email.subject).toContain("84 分");
    expect(email.subject).toContain("SOLUSDT");
    expect(email.subject).not.toContain("【GPT Signal】");
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

  test("builds one plain strong-alert summary email ordered by score", () => {
    const ethSignal = { ...signal, symbol: "ETHUSDT", score: 89, level: "S" as const };
    const bnbSignal = { ...signal, symbol: "BNBUSDT", score: 88, level: "S" as const };
    const solSignal = { ...signal, symbol: "SOLUSDT", score: 84, level: "S" as const };
    const summary = buildSignalSummaryEmail([bnbSignal, solSignal, ethSignal]);

    expect(summary.subject).toContain("做多上涨强提醒");
    expect(summary.subject).toContain("3 个S级机会");
    expect(summary.subject).toContain("最高 89 分");
    expect(summary.subject).toContain("ETHUSDT");
    expect(summary.subject).not.toContain("【GPT Signal】");
    expect(summary.body).toContain("本轮共发现 3 个强提醒机会");
    expect(summary.body.indexOf("ETHUSDT")).toBeLessThan(summary.body.indexOf("BNBUSDT"));
    expect(summary.body.indexOf("BNBUSDT")).toBeLessThan(summary.body.indexOf("SOLUSDT"));
    expect(summary.body).toContain("这不是自动买入提醒");
    expect(summary.body).not.toContain("market_regime");
  });

  test("formats sender display name as GPT Signal", () => {
    const message = formatEmailMessage({
      from: "zunxian.chi@gmail.com",
      fromName: "GPT Signal",
      to: "user@example.com",
      subject: "做多上涨提醒｜1 个机会｜最高 84 分｜SOLUSDT",
      body: "hello"
    });

    expect(message).toContain("From: GPT Signal <zunxian.chi@gmail.com>");
    expect(message).not.toContain("From: zunxian.chi");
  });

  test("resolves sender display name from NOTIFICATION_EMAIL_FROM and email from SMTP_USER", () => {
    expect(resolveEmailSender("GPT Signal", "zunxian.chi@gmail.com")).toEqual({
      email: "zunxian.chi@gmail.com",
      name: "GPT Signal"
    });
  });

  test("falls back to the email address when NOTIFICATION_EMAIL_FROM has no display name", () => {
    expect(resolveEmailSender("", "zunxian.chi@gmail.com")).toEqual({
      email: "zunxian.chi@gmail.com",
      name: "zunxian.chi@gmail.com"
    });
  });

  test("only sends strong alert emails for S-level symbols with positive backtest evidence", () => {
    const ethSignal = { ...signal, symbol: "ETHUSDT", level: "S" as const, score: 90 };
    const avaxSignal = { ...signal, symbol: "AVAXUSDT", level: "S" as const, score: 91 };
    const aSignal = { ...signal, symbol: "BNBUSDT", level: "A" as const, score: 84 };

    expect(shouldSendStrongAlert(ethSignal)).toBe(true);
    expect(shouldSendStrongAlert(avaxSignal)).toBe(false);
    expect(shouldSendStrongAlert(aSignal)).toBe(false);
    expect(filterStrongAlertSignals([aSignal, avaxSignal, ethSignal])).toEqual([ethSignal]);
  });

  test("runs strong alert windows on the configured candle boundary", () => {
    expect(shouldRunStrongAlertWindow(Date.UTC(2026, 6, 3, 10, 29, 59, 999), 30)).toBe(true);
    expect(shouldRunStrongAlertWindow(Date.UTC(2026, 6, 3, 10, 44, 59, 999), 30)).toBe(false);
    expect(shouldRunStrongAlertWindow(Date.UTC(2026, 6, 3, 10, 14, 59, 999), 15)).toBe(true);
  });
});
