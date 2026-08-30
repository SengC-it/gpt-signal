import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { getBenchmarkTimeSeriesSummaries, getRecentSignalReviews, getSchedulerHealth, type DisplaySignalReview } from "@/lib/data-access";
import { buildEdgeEvidence } from "@/lib/signal/edge-evidence";
import {
  buildProfitabilityBreakdown,
  summarizeProfitability,
  type BenchmarkTimeSeriesSummary,
  type BreakdownKey
} from "@/lib/signal/profitability-analytics";
import { isSettledReviewStatus } from "@/lib/signal/review";
import { PRODUCTION_SIGNAL_STRATEGIES } from "@/lib/signal/profitability-config";

export const dynamic = "force-dynamic";

const BREAKDOWNS: Array<{ key: BreakdownKey; label: string }> = [
  { key: "strategyVersion", label: "Strategy version" },
  { key: "signalType", label: "Signal type" },
  { key: "symbol", label: "Symbol" },
  { key: "direction", label: "Direction" },
  { key: "marketRegime", label: "Market regime" },
  { key: "month", label: "Month" }
];

export default async function ReviewsPage() {
  const [reviews, benchmarkSummaries, scheduler] = await Promise.all([
    getRecentSignalReviews(5000),
    getBenchmarkTimeSeriesSummaries(),
    getSchedulerHealth()
  ]);
  const production = reviews.filter((review) => review.deliveryMode === "production");
  const shadow = reviews.filter((review) => review.deliveryMode === "shadow");
  const historicalDelivery = reviews.filter((review) => review.runtimeStrategyState === "historical_delivery");
  const evidence = buildEdgeEvidence(reviews
    .filter((review) => review.runtimeStrategyState !== "historical_delivery")
    .map((review) => ({
    strategyVersion: review.strategyVersion ?? "legacy/unknown",
    signalType: review.signalType,
    symbol: review.symbol,
    direction: review.direction,
    marketRegime: review.marketRegime,
    settled: isSettledReviewStatus(review.status),
    netR: review.netR
    })));

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <h1 className="page-title">盈利分析与信号复盘</h1>
          <p className="page-subtitle">
            以下均为 Signal Review / Hypothetical Benchmark，不是用户真实账户、真实仓位或真实 PnL。
          </p>
        </div>
        <StatusBadge value={scheduler.status} />
      </header>

      <section className="panel">
        <h2>Scheduler Health</h2>
        <div className="grid metrics">
          <MetricCard label="状态" value={scheduler.status} note="同时检查同步与 candle freshness" />
          <MetricCard label="最近成功同步" value={formatTime(scheduler.lastSuccessfulSync)} />
          <MetricCard label="最新 candle" value={formatTime(scheduler.lastCandleTimestamp)} />
          <MetricCard
            label="同步延迟"
            value={Number.isFinite(scheduler.syncLagMinutes) ? `${scheduler.syncLagMinutes.toFixed(1)}m` : "未知"}
            note={`连续错误 ${scheduler.consecutiveSyncErrors}`}
          />
        </div>
        <p className="page-subtitle" style={{ marginTop: 12 }}>
          Current runtime Production strategies: <strong>{PRODUCTION_SIGNAL_STRATEGIES.length} (expected)</strong> · historical production-delivery rows: {historicalDelivery.length}. Historical rows remain visible for audit and are excluded from current Edge Evidence.
        </p>
      </section>

      <BenchmarkMetrics title="Production delivery history (audit only)" reviews={production} timeSeries={benchmarkSummaries.production} />
      <BenchmarkMetrics title="Shadow candidates" reviews={shadow} timeSeries={benchmarkSummaries.shadow} />

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Breakdown — PF + Expectancy + DD</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>维度</th><th>值</th><th>Reviews</th><th>Settled</th><th>PF</th><th>Expectancy R</th><th>Net R</th><th>Realized DD</th><th>Current MTM adjusted equity</th>
              </tr>
            </thead>
            <tbody>
              {BREAKDOWNS.flatMap(({ key, label }) => buildProfitabilityBreakdown(reviews, key).map((row) => (
                <tr key={`${key}:${row.value}`}>
                  <td>{label}</td><td>{row.value}</td><td>{row.totalReviews}</td><td>{row.settled}</td>
                  <td>{formatRatio(row.profitFactor)}</td><td>{row.expectancyR.toFixed(4)}</td><td>{row.netR.toFixed(4)}</td>
                  <td>{row.realizedMaxDrawdownPct.toFixed(2)}%</td><td>{row.currentMtmAdjustedEquity.toFixed(2)}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Signal Edge Evidence（五维严格隔离）</h2>
        <p className="page-subtitle">旧 strategy version 的表现不会否决新版本；少于 30 笔 settled 一律 UNPROVEN。</p>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr><th>状态</th><th>版本</th><th>类型</th><th>Symbol</th><th>方向</th><th>Regime</th><th>Settled</th><th>PF</th><th>Expectancy R</th></tr>
            </thead>
            <tbody>
              {evidence.map((item) => (
                <tr key={[item.strategyVersion, item.signalType, item.symbol, item.direction, item.marketRegime].join(":")}>
                  <td><StatusBadge value={item.status} /></td><td>{item.strategyVersion}</td><td>{item.signalType}</td>
                  <td>{item.symbol}</td><td>{item.direction}</td><td>{item.marketRegime}</td><td>{item.settledTrades}</td>
                  <td>{formatRatio(item.profitFactor)}</td><td>{item.expectancyR.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>逐信号 review</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>信号时间</th><th>模式</th><th>运行时状态</th><th>版本</th><th>交易对</th><th>方向</th><th>状态</th><th>入场</th><th>止损</th><th>TP1</th>
                <th>Review price</th><th>Realized gross/net</th><th>MTM gross/net</th><th>Realized / current R</th><th>MFE / MAE</th>
              </tr>
            </thead>
            <tbody>
              {reviews.length === 0 ? <tr><td colSpan={15}>暂无复盘数据。</td></tr> : reviews.map((review) => (
                <tr key={review.id}>
                  <td>{formatTime(review.signalSentAt)}</td><td><StatusBadge value={review.deliveryMode} /></td><td>{runtimeStateLabel(review.runtimeStrategyState)}</td><td>{review.strategyVersion ?? "legacy/unknown"}</td>
                  <td><Link href={`/signals/${review.signalId}`}>{review.symbol}</Link></td><td><StatusBadge value={review.direction} /></td><td><StatusBadge value={statusLabel(review.status)} /></td>
                  <td>{priceRange(review.entryLow, review.entryHigh)}</td><td>{review.stopLoss}</td><td>{review.tp1}</td><td>{review.currentReviewPrice ?? review.exitPrice ?? "-"}</td>
                  <td>{formatPnl(review.grossPnlPct)} / {formatPnl(review.netPnlPct)}</td>
                  <td>{formatPnl(review.unrealizedGrossPnlPct)} / {formatPnl(review.unrealizedNetPnlPct)}</td>
                  <td>{formatPnl(review.netR, " R")} / {formatPnl(review.currentR, " R")}</td><td>{review.mfe.toFixed(3)} / {review.mae.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

function BenchmarkMetrics({
  title,
  reviews,
  timeSeries
}: {
  title: string;
  reviews: DisplaySignalReview[];
  timeSeries: BenchmarkTimeSeriesSummary;
}) {
  const summary = summarizeProfitability(reviews);
  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <h2>{title} — Hypothetical Signal Benchmark</h2>
      <div className="grid metrics">
        <MetricCard label="Reviews / settled / open" value={`${summary.totalReviews} / ${summary.settled} / ${summary.open}`} note={`Wins ${summary.wins} · Losses ${summary.losses}`} />
        <MetricCard label="Profit Factor" value={formatRatio(summary.profitFactor)} note="核心盈利质量指标" />
        <MetricCard label="Expectancy" value={`${summary.expectancyR.toFixed(4)} R`} note={`Win rate ${summary.winRate.toFixed(2)}%`} />
        <MetricCard label="Net R / PnL" value={`${summary.netR.toFixed(3)} R`} note={`${summary.netPnlPct.toFixed(3)}%（信号级合计）`} />
        <MetricCard label="Avg win / loss" value={`${summary.averageWinR.toFixed(3)} / -${summary.averageLossR.toFixed(3)} R`} />
        <MetricCard label="Payoff / BE win rate" value={`${formatRatio(summary.payoffRatio)} / ${summary.breakevenWinRate.toFixed(2)}%`} />
        <MetricCard label="Realized max DD" value={`${summary.realizedMaxDrawdownPct.toFixed(2)}%`} note="复合 hypothetical equity" />
        <MetricCard label="Current MTM adjusted equity" value={summary.currentMtmAdjustedEquity.toFixed(2)} note="当前静态调整值，不是 Max Drawdown" />
        <MetricCard
          label="MTM DD since snapshot tracking started"
          value={timeSeries.mtmMaxDrawdownPct === null ? "—" : `${timeSeries.mtmMaxDrawdownPct.toFixed(2)}%`}
          note={timeSeries.benchmarkEquity === null ? "等待首个 review snapshot" : `${timeSeries.snapshotCount} snapshots · Equity ${timeSeries.benchmarkEquity.toFixed(2)}`}
        />
      </div>
    </section>
  );
}

function statusLabel(status: string) {
  return ({ waiting_entry: "待入场", open: "Open MTM", hit_tp1: "TP1", hit_tp2: "TP2 legacy", hit_tp3: "TP3 legacy", hit_sl: "SL" } as Record<string, string>)[status] ?? status;
}

function runtimeStateLabel(value: DisplaySignalReview["runtimeStrategyState"]) {
  return value === "current_runtime_production" ? "current runtime Production" : value === "shadow_candidate" ? "Shadow candidate" : "historical delivery";
}

function priceRange(low: number, high: number) { return low === high ? String(low) : `${low} - ${high}`; }

function formatTime(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}

function formatPnl(value: number | null, suffix = "%") { return value === null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(4)}${suffix}`; }
function formatRatio(value: number) { return Number.isFinite(value) ? value.toFixed(3) : "∞"; }
