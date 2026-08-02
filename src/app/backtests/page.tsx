import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { runBacktest } from "@/lib/signal/backtest";
import { sampleSignals } from "@/lib/sample-data";

export default function BacktestsPage() {
  const runnable = sampleSignals.filter((item) => item.plan);
  const result = runBacktest(
    runnable.map((item) => ({
      direction: item.direction,
      plan: item.plan!,
      futureCandles: []
    }))
  );

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <h1 className="page-title">回测</h1>
          <p className="page-subtitle">只按入场、SL、TP 结算；数据窗口结束时未触发的信号保持未结算，不计为亏损。</p>
        </div>
        <form action="/api/backtests/run" method="post">
          <button className="button primary" type="submit">运行示例回测</button>
        </form>
      </header>
      <div className="grid metrics">
        <MetricCard label="信号数" value={result.totalTrades} />
        <MetricCard label="已结算" value={result.settledTrades} />
        <MetricCard label="胜率" value={`${result.winRate.toFixed(1)}%`} note="仅按已结算交易计算" />
        <MetricCard label="平均净 R" value={result.avgR.toFixed(2)} />
        <MetricCard label="持仓中" value={result.openTrades} />
        <MetricCard label="待入场" value={result.waitingEntryTrades} />
      </div>
    </AppShell>
  );
}
