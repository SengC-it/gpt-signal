import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { getRadarRows } from "@/lib/data-access";

export const dynamic = "force-dynamic";

export default async function RadarPage() {
  const radar = await getRadarRows();

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <h1 className="page-title">机会雷达</h1>
          <p className="page-subtitle">动态币池、相对强弱、量能异常和风险过滤。</p>
        </div>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>币种</th>
              <th>币池</th>
              <th>相对 BTC</th>
              <th>成交额倍数</th>
              <th>ATR 状态</th>
              <th>Funding</th>
              <th>评分</th>
            </tr>
          </thead>
          <tbody>
            {radar.map((item) => (
              <tr key={item.symbol}>
                <td>{item.symbol}</td>
                <td><StatusBadge value={item.pool} /></td>
                <td>{item.rs}%</td>
                <td>{item.volumeRatio}x</td>
                <td>{item.atrState}</td>
                <td>{item.funding}</td>
                <td>{item.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
