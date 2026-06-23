import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";

export default function RiskPage() {
  return (
    <AppShell>
      <header className="page-header">
        <div>
          <h1 className="page-title">策略风控</h1>
          <p className="page-subtitle">阈值、冷却、熔断和降频状态。</p>
        </div>
      </header>
      <div className="grid metrics">
        <MetricCard label="A/S 最低评分" value="78 / 88" />
        <MetricCard label="最低数据质量" value="90" />
        <MetricCard label="最低加权 RR" value="1.3" />
        <MetricCard label="熔断状态" value="未触发" />
      </div>
      <section className="panel" style={{ marginTop: 12 }}>
        <h2>默认熔断规则</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>条件</th><th>动作</th></tr>
            </thead>
            <tbody>
              <tr><td>最近 10 个 A 级信号平均 R &lt; -0.3</td><td>暂停 A 级</td></tr>
              <tr><td>连续止损 ≥ 5 笔</td><td>只发 S 级</td></tr>
              <tr><td>BTC 极端波动</td><td>只发风险提醒</td></tr>
              <tr><td>数据质量 &lt; 75</td><td>暂停该币</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

