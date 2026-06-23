import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { sampleSignals } from "@/lib/sample-data";

export default function SignalsPage() {
  return (
    <AppShell>
      <header className="page-header">
        <div>
          <h1 className="page-title">信号列表</h1>
          <p className="page-subtitle">只把 A/S 级信号升级为交易计划，B 级保留观察。</p>
        </div>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>币种</th>
              <th>方向</th>
              <th>类型</th>
              <th>等级</th>
              <th>评分</th>
              <th>入场区</th>
              <th>SL/TP2</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {sampleSignals.map((signal) => (
              <tr key={signal.symbol}>
                <td>样例</td>
                <td>{signal.symbol}</td>
                <td><StatusBadge value={signal.direction} /></td>
                <td>{signal.signalType}</td>
                <td><StatusBadge value={signal.level} /></td>
                <td>{signal.score}</td>
                <td>{signal.plan ? `${signal.plan.entryLow}-${signal.plan.entryHigh}` : "等待确认"}</td>
                <td>{signal.plan ? `${signal.plan.stopLoss}/${signal.plan.tp2}` : "等待确认"}</td>
                <td><Link className="button" href={`/signals/${signal.symbol}`}>查看</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

