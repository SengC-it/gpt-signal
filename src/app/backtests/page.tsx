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
          <p className="page-subtitle">保守规则：同 K 同时触及 TP/SL 时按 SL 处理。</p>
        </div>
        <form action="/api/backtests/run" method="post">
          <button className="button primary" type="submit">运行样例回测</button>
        </form>
      </header>
      <div className="grid metrics">
        <MetricCard label="总交易数" value={result.totalTrades} />
        <MetricCard label="胜率" value={`${result.winRate.toFixed(1)}%`} />
        <MetricCard label="平均 R" value={result.avgR.toFixed(2)} />
        <MetricCard label="最大连续亏损" value={result.maxLosingStreak} />
      </div>
    </AppShell>
  );
}

