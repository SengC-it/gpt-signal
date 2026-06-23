import type { SignalEvaluation } from "@/lib/signal/types";

export function buildSignalEmail(signal: SignalEvaluation) {
  const plan = signal.plan;
  const levelName = signal.level === "S" ? "S级强信号" : signal.level === "A" ? "A级合约信号" : "机会预警";
  const subject = plan
    ? `【${levelName}】${signal.symbol}${signal.direction === "LONG" ? "做多" : "做空"} | 入场区 ${plan.entryLow}-${plan.entryHigh} | 加权RR 1:${plan.weightedRr.toFixed(1)}`
    : `【${levelName}】${signal.symbol}${signal.direction === "LONG" ? "做多" : "做空"}观察 | 等确认`;

  const body = [
    `信号等级：${signal.level}`,
    `信号类型：${signal.signalType}`,
    `交易方向：${signal.direction}`,
    `生命周期状态：${signal.lifecycleStatus}`,
    `市场模式：${signal.marketRegime}`,
    `BTC 状态：${signal.btcState}`,
    `数据质量评分：${signal.dataQualityScore}`,
    `相对 BTC 强弱：${signal.relativeStrengthScore.toFixed(2)}%`,
    plan ? `参考入场区间：${plan.entryLow} - ${plan.entryHigh}` : "参考入场区间：等待确认",
    plan ? `不追价位置：${plan.noChasePrice}` : "不追价位置：等待确认",
    plan ? `止损SL：${plan.stopLoss}` : "止损SL：等待确认",
    plan ? `TP1/TP2/TP3：${plan.tp1} / ${plan.tp2} / ${plan.tp3}` : "TP1/TP2/TP3：等待确认",
    plan ? `理论RR：1:${plan.theoreticalRr}` : "理论RR：等待确认",
    plan ? `加权RR：1:${plan.weightedRr.toFixed(1)}` : "加权RR：等待确认",
    plan ? `成本后RR：1:${plan.costAdjustedRr.toFixed(2)}` : "成本后RR：等待确认",
    `触发原因：${signal.reasons.join("；")}`,
    `失效条件：${signal.invalidationRules.join("；")}`,
    "风险提示：本信号为交易辅助，不代表必然盈利。合约交易请严格控制仓位。"
  ].join("\n");

  return { subject, body };
}

