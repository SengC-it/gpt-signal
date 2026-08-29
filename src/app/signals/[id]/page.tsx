import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/status-badge";
import { getSignalById } from "@/lib/data-access";
import { buildSignalEmail } from "@/lib/notifications/templates";

export const dynamic = "force-dynamic";

export default async function SignalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const signal = await getSignalById(id);
  const email = buildSignalEmail(signal);

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <h1 className="page-title">{signal.symbol} 信号详情</h1>
          <p className="page-subtitle">这笔交易该怎么下单、在哪里止盈止损，以及什么时候退出。</p>
        </div>
        <StatusBadge value={signal.lifecycleStatus} />
      </header>

      <div className="split">
        <section className="panel">
          <h2>交易计划</h2>
          <dl className="kv">
            <dt>方向</dt><dd><StatusBadge value={signal.direction} /></dd>
            <dt>等级/评分</dt><dd>{signal.level} / {signal.score}</dd>
            <dt>策略</dt><dd>{signal.signalType === "alt_basket_short" ? "BTC 弱势等权做空" : "趋势回调"}</dd>
            <dt>计划仓位</dt><dd>{weightLabel(signal.noChaseRule.weightPct)}</dd>
            <dt>参考入场</dt><dd>{signal.plan ? priceRange(signal.plan.entryLow, signal.plan.entryHigh) : "等待确认"}</dd>
            <dt>止盈价</dt><dd>{signal.plan?.tp1 ?? "等待确认"}</dd>
            <dt>止损价</dt><dd>{signal.plan?.stopLoss ?? "等待确认"}</dd>
            <dt>预计盈亏比</dt><dd>{signal.plan ? `1:${signal.plan.weightedRr.toFixed(1)}` : "等待确认"}</dd>
          </dl>
        </section>

        <section className="panel">
          <h2>为什么提醒</h2>
          <p>{signal.reasons.join("；")}</p>
          <h3>退出和平仓规则</h3>
          <p>{signal.invalidationRules.join("；")}</p>
          <h3>邮件标题</h3>
          <p>{email.subject}</p>
          <h3>正文预览</h3>
          <pre style={{ whiteSpace: "pre-wrap", color: "var(--muted)" }}>{email.body}</pre>
        </section>
      </div>
    </AppShell>
  );
}

function priceRange(low: number, high: number) {
  return low === high ? String(low) : `${low} - ${high}`;
}

function weightLabel(value: unknown) {
  const weight = Number(value);
  return Number.isFinite(weight) && weight > 0 ? `整组计划的 ${weight.toFixed(2)}%` : "按个人风险控制";
}
