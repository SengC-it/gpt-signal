import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { getRecentSignals } from "@/lib/data-access";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  const signals = await getRecentSignals(50);

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <h1 className="page-title">信号列表</h1>
          <p className="page-subtitle">每个交易对单独一行；入场、止盈和止损价格都按该交易对显示。</p>
        </div>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>币种</th>
              <th>方向</th>
              <th>策略</th>
              <th>等级</th>
              <th>评分</th>
              <th>参考入场</th>
              <th>止盈价</th>
              <th>止损价</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((signal) => (
              <tr key={signal.id}>
                <td>{formatTime(signal.createdAt)}</td>
                <td>{signal.symbol}</td>
                <td><StatusBadge value={signal.direction} /></td>
                <td>{strategyLabel(signal.signalType)}</td>
                <td><StatusBadge value={signal.level} /></td>
                <td>{signal.score}</td>
                <td>{signal.plan ? priceRange(signal.plan.entryLow, signal.plan.entryHigh) : "等待确认"}</td>
                <td>{signal.plan?.tp1 ?? "等待确认"}</td>
                <td>{signal.plan?.stopLoss ?? "等待确认"}</td>
                <td><Link className="button" href={`/signals/${signal.id}`}>查看</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

function strategyLabel(value: string) {
  return value === "alt_basket_short" ? "BTC 弱势等权做空" : "趋势回调";
}

function priceRange(low: number, high: number) {
  return low === high ? String(low) : `${low} - ${high}`;
}

function formatTime(value: string) {
  if (!value) return "样例";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}
