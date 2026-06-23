import type { SignalEvaluation } from "@/lib/signal/types";

export function buildSignalEmail(signal: SignalEvaluation) {
  const plan = signal.plan;
  const sideText = signal.direction === "LONG" ? "做多" : "做空";
  const plainSideText = signal.direction === "LONG" ? "上涨" : "下跌";
  const levelName = signal.level === "S" ? "很强" : signal.level === "A" ? "较强" : "观察";
  const subject = plan
    ? `${sideText}${plainSideText}提醒｜${signal.score} 分｜${signal.symbol}｜风险价 ${plan.stopLoss}`
    : `${sideText}${plainSideText}提醒｜${signal.score} 分｜${signal.symbol}｜先观察`;

  const body = [
    `币种：${signal.symbol}`,
    `方向：关注${sideText}，也就是判断后面可能${plainSideText}。`,
    `强度：${levelName}，系统评分 ${signal.score}/100。`,
    "",
    plan
      ? `建议观察价格区间：${plan.entryLow} - ${plan.entryHigh}。价格进入这个区间再考虑，不要追。`
      : "现在还没有合适的价格区间，只适合先观察，不建议马上行动。",
    plan ? `风险价：${plan.stopLoss}。如果价格碰到这里，说明这次判断可能错了。` : "风险价：等待确认。",
    plan ? `第一目标：${plan.tp1}；第二目标：${plan.tp2}；第三目标：${plan.tp3}。` : "目标价：等待确认。",
    plan ? `如果价格已经超过 ${plan.noChasePrice}，就不要追了，容易买在高位或卖在低位。` : "不追价位置：等待确认。",
    "",
    `为什么提醒：${plainReasons(signal.reasons)}`,
    `什么时候放弃：${plainReasons(signal.invalidationRules)}`,
    "",
    "这不是自动买入提醒，也不是保证赚钱。它只是提醒你：这里可能有机会，但需要你自己确认仓位和风险。",
    "合约波动很大，请控制仓位；看不懂或来不及判断时，宁可错过。"
  ].join("\n");

  return { subject, body };
}

export function buildSignalSummaryEmail(signals: SignalEvaluation[]) {
  const sortedSignals = [...signals].sort((a, b) => b.score - a.score);
  const topSignal = sortedSignals[0];
  const subject = topSignal
    ? `${directionLabel(topSignal)}提醒｜${sortedSignals.length} 个机会｜最高 ${topSignal.score} 分｜${topSignal.symbol}`
    : "暂无新机会提醒";
  const lines = [
    `本轮共发现 ${sortedSignals.length} 个值得关注的机会，已按评分从高到低排列。`,
    "",
    ...sortedSignals.flatMap((signal, index) => signalSummaryLines(signal, index + 1)),
    "这不是自动买入提醒，也不是保证赚钱。它只是提醒你：这里可能有机会，但需要你自己确认仓位和风险。",
    "合约波动很大，请控制仓位；看不懂或来不及判断时，宁可错过。"
  ];

  return { subject, body: lines.join("\n") };
}

function directionLabel(signal: SignalEvaluation) {
  return signal.direction === "LONG" ? "做多上涨" : "做空下跌";
}

function signalSummaryLines(signal: SignalEvaluation, rank: number) {
  const plan = signal.plan;
  const sideText = signal.direction === "LONG" ? "做多" : "做空";
  const plainSideText = signal.direction === "LONG" ? "上涨" : "下跌";
  const levelName = signal.level === "S" ? "很强" : signal.level === "A" ? "较强" : "观察";

  return [
    `${rank}. ${signal.symbol}｜${levelName}｜${signal.score}/100｜关注${sideText}`,
    `   判断：后面可能${plainSideText}。`,
    plan
      ? `   观察价格：${plan.entryLow} - ${plan.entryHigh}；风险价：${plan.stopLoss}；目标：${plan.tp1} / ${plan.tp2} / ${plan.tp3}。`
      : "   观察价格：暂未形成合适区间，先观察。",
    plan
      ? `   不要追：如果价格已经超过 ${plan.noChasePrice}，这次就先放过。`
      : "   不要追：等待更清楚的位置。",
    `   原因：${plainReasons(signal.reasons)}`,
    `   放弃条件：${plainReasons(signal.invalidationRules)}`,
    ""
  ];
}

function plainReasons(items: string[]) {
  if (items.length === 0) return "暂无更多原因。";
  return items.join("；");
}
