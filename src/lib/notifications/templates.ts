import type { SignalEvaluation } from "@/lib/signal/types";

export function buildSignalEmail(signal: SignalEvaluation) {
  if (signal.signalType === "alt_basket_short") return buildAltBasketShortEmail(signal);

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
    plan ? "Execution: close the full position at TP1; TP2/TP3 are reference extensions only." : "",
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

function buildAltBasketShortEmail(signal: SignalEvaluation) {
  const plan = signal.plan;
  const basketSymbols = textField(signal.noChaseRule.basketSymbols, "ETHUSDT,SOLUSDT,BNBUSDT,LINKUSDT,AVAXUSDT,DOGEUSDT");
  const entryPrices = parseSymbolValues(signal.noChaseRule.entryPrices);
  const tpPct = numberField(signal.noChaseRule.takeProfitPct, 6);
  const slPct = numberField(signal.noChaseRule.stopLossPct, 5);
  const btcClose = numberField(signal.noChaseRule.btc4hClose, 0);
  const btcSma50 = numberField(signal.noChaseRule.btcSma50, 0);
  const symbols = basketSymbols.split(",").map((item) => item.trim()).filter(Boolean);

  if (signal.symbol !== "ALT_SHORT_BASKET" && plan) {
    const subject = `做空提醒｜${signal.symbol}｜入场 ${formatPrice(plan.entryLow)}｜止盈 ${formatPrice(plan.tp1)}｜止损 ${formatPrice(plan.stopLoss)}`;
    const body = [
      `交易对：${signal.symbol}`,
      "方向：卖出 / 做空",
      `参考入场价：${formatPrice(plan.entryLow)}`,
      `止盈价：${formatPrice(plan.tp1)}（价格下跌 ${tpPct}%）`,
      `止损价：${formatPrice(plan.stopLoss)}（价格上涨 ${slPct}%）`,
      `计划仓位：整组资金的 ${numberField(signal.noChaseRule.weightPct, 100 / Math.max(symbols.length, 1)).toFixed(2)}%`,
      "",
      "怎么执行：",
      "1. 收到提醒后，在下一根 15 分钟 K 线开盘附近选择“卖出/做空”。",
      "2. 成交后马上设置止盈和止损；如果成交价与参考价不同，以实际成交价重新计算。",
      `3. 做空止盈价 = 实际成交价 × ${(1 - tpPct / 100).toFixed(2)}；止损价 = 实际成交价 × ${(1 + slPct / 100).toFixed(2)}。`,
      `4. ${signal.symbol} 碰到自己的止盈或止损价时，只平掉这一笔。`,
      `5. 如果 BTC 4 小时收盘重新站上 SMA50${btcSma50 > 0 ? `（当前参考 ${formatPrice(btcSma50)}）` : ""}，平掉整组所有剩余仓位。`,
      "",
      "如果看到邮件时价格已经明显离开参考入场价，不要追单，等下一次提醒。",
      "这不是自动交易或收益保证。合约风险很高，请使用自己能承受损失的小仓位。"
    ].join("\n");

    return { subject, body };
  }

  const subject = `做空计划｜${symbols.length} 个币｜每币止盈 ${tpPct}% / 止损 ${slPct}%`;
  const orderLines = symbols.map((symbol) => {
    const entry = entryPrices.get(symbol);
    if (!entry) return `${symbol}：等待参考价格`;
    return `${symbol}：入场 ${formatPrice(entry)}｜止盈 ${formatPrice(entry * (1 - tpPct / 100))}｜止损 ${formatPrice(entry * (1 + slPct / 100))}`;
  });

  const body = [
    `这是 1 组等权做空计划，共 ${symbols.length} 笔。把准备投入的总仓位平均分成 ${symbols.length} 份，每个币使用 1 份。`,
    "",
    "下单清单：",
    ...orderLines,
    "",
    "怎么执行：",
    "1. 收到提醒后，在下一根 15 分钟 K 线开盘附近，逐个选择“卖出/做空”。",
    "2. 每一笔成交后，马上按清单设置自己的止盈价和止损价。",
    `3. 如果实际成交价不同：止盈价 = 成交价 × ${(1 - tpPct / 100).toFixed(2)}；止损价 = 成交价 × ${(1 + slPct / 100).toFixed(2)}。`,
    "4. 某个币先碰到止盈或止损，只平掉这个币，其他币继续持有。",
    `5. 如果 BTC 4 小时收盘重新站上 SMA50${btcSma50 > 0 ? `（当前参考 ${formatPrice(btcSma50)}）` : ""}，立即平掉所有剩余仓位。`,
    "",
    btcClose > 0 && btcSma50 > 0 ? `触发原因：BTC 4 小时收盘价 ${formatPrice(btcClose)} 低于 SMA50 ${formatPrice(btcSma50)}。` : "触发原因：BTC 4 小时收盘价低于 SMA50。",
    "如果看到邮件时价格已经明显离开参考入场价，不要追单，等下一次提醒。",
    "",
    "这不是自动交易或收益保证。合约风险很高，请使用自己能承受损失的小仓位。"
  ].join("\n");

  return { subject, body };
}

export function buildAltBasketSummaryEmail(signals: SignalEvaluation[]) {
  const components = signals.filter((signal) => signal.signalType === "alt_basket_short" && signal.plan);
  if (components.length === 0) {
    return { subject: "暂无可执行的做空计划", body: "本轮没有生成完整的逐币入场、止盈和止损价格。" };
  }

  const first = components[0];
  const tpPct = numberField(first.noChaseRule.takeProfitPct, 6);
  const slPct = numberField(first.noChaseRule.stopLossPct, 5);
  const btcClose = numberField(first.noChaseRule.btc4hClose, 0);
  const btcSma50 = numberField(first.noChaseRule.btcSma50, 0);
  const subject = `做空计划｜${components.length} 个币｜每币止盈 ${tpPct}% / 止损 ${slPct}%`;
  const body = [
    `这是 1 组等权做空计划，共 ${components.length} 笔。把准备投入的总仓位平均分成 ${components.length} 份，每个币使用 1 份。`,
    "",
    "下单清单：",
    ...components.map((signal) => `${signal.symbol}：卖出/做空｜入场 ${formatPrice(signal.plan!.entryLow)}｜止盈 ${formatPrice(signal.plan!.tp1)}｜止损 ${formatPrice(signal.plan!.stopLoss)}`),
    "",
    "执行规则：",
    "1. 收到提醒后，在下一根 15 分钟 K 线开盘附近下单。",
    "2. 每笔成交后立即设置自己的止盈和止损。",
    `3. 实际成交价不同就重算：止盈 = 成交价 × ${(1 - tpPct / 100).toFixed(2)}；止损 = 成交价 × ${(1 + slPct / 100).toFixed(2)}。`,
    "4. 单个币碰到止盈或止损，只平这一笔。",
    `5. BTC 4 小时收盘重新站上 SMA50${btcSma50 > 0 ? `（当前参考 ${formatPrice(btcSma50)}）` : ""}时，平掉所有剩余仓位。`,
    "",
    btcClose > 0 && btcSma50 > 0 ? `触发时 BTC：${formatPrice(btcClose)}；SMA50：${formatPrice(btcSma50)}。` : "",
    "价格已明显偏离参考入场价时不要追单。合约风险很高，请使用小仓位。"
  ].filter(Boolean).join("\n");

  return { subject, body };
}

export function buildSignalSummaryEmail(signals: SignalEvaluation[]) {
  const sortedSignals = [...signals].sort((a, b) => b.score - a.score);
  const topSignal = sortedSignals[0];
  const subject = topSignal
    ? `${directionLabel(topSignal)}强提醒｜${sortedSignals.length} 个S级机会｜最高 ${topSignal.score} 分｜${topSignal.symbol}`
    : "暂无新机会提醒";
  const lines = [
    `本轮共发现 ${sortedSignals.length} 个强提醒机会，已按评分从高到低排列。`,
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
    plan ? "   Execution: close the full position at TP1; TP2/TP3 are reference extensions only." : "",
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

function textField(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberField(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseSymbolValues(value: unknown) {
  return new Map(
    String(value ?? "")
      .split(",")
      .map((item) => item.split(":"))
      .map(([symbol, raw]) => [symbol?.trim().toUpperCase(), Number(raw)] as const)
      .filter(([symbol, numeric]) => Boolean(symbol) && Number.isFinite(numeric) && numeric > 0)
  );
}

function formatPrice(value: number) {
  const digits = value >= 1000 ? 2 : value >= 100 ? 3 : value >= 1 ? 4 : 6;
  return String(Math.round(value * 10 ** digits) / 10 ** digits);
}
