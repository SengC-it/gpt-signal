import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { sampleRadar, sampleSignals } from "@/lib/sample-data";

export default function DashboardPage() {
  const planned = sampleSignals.filter((item) => item.lifecycleStatus === "planned");

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <h1 className="page-title">交易机会工作台</h1>
          <p className="page-subtitle">生产级 SaaS 骨架已就绪；未配置 Supabase 时展示样例数据。</p>
        </div>
        <form action="/api/jobs/sync-market" method="post">
          <button className="button primary" type="submit">同步行情</button>
        </form>
      </header>

      <div className="grid metrics">
        <MetricCard label="BTC 状态" value="weak_bull" note="大盘不压制做多计划" />
        <MetricCard label="市场模式" value="trend" note="顺势回踩权重较高" />
        <MetricCard label="今日 A/S 信号" value={planned.length} note="已通过计划门槛" />
        <MetricCard label="熔断状态" value="正常" note="未触发连续亏损降频" />
      </div>

      <div className="split" style={{ marginTop: 12 }}>
        <section className="panel">
          <h2>最新信号</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>币种</th>
                  <th>方向</th>
                  <th>等级</th>
                  <th>评分</th>
                  <th>生命周期</th>
                  <th>加权RR</th>
                </tr>
              </thead>
              <tbody>
                {sampleSignals.map((signal) => (
                  <tr key={signal.symbol}>
                    <td>{signal.symbol}</td>
                    <td><StatusBadge value={signal.direction} /></td>
                    <td><StatusBadge value={signal.level} /></td>
                    <td>{signal.score}</td>
                    <td><StatusBadge value={signal.lifecycleStatus} /></td>
                    <td>{signal.plan ? `1:${signal.plan.weightedRr.toFixed(1)}` : "等待确认"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2>动态机会池</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>币种</th>
                  <th>池</th>
                  <th>RS</th>
                  <th>量能</th>
                  <th>评分</th>
                </tr>
              </thead>
              <tbody>
                {sampleRadar.map((item) => (
                  <tr key={item.symbol}>
                    <td>{item.symbol}</td>
                    <td><StatusBadge value={item.pool} /></td>
                    <td>{item.rs}%</td>
                    <td>{item.volumeRatio}x</td>
                    <td>{item.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

