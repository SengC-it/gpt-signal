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
          <p className="page-subtitle">生命周期、交易计划、触发原因和通知模板。</p>
        </div>
        <StatusBadge value={signal.lifecycleStatus} />
      </header>

      <div className="split">
        <section className="panel">
          <h2>交易计划</h2>
          <dl className="kv">
            <dt>方向</dt><dd><StatusBadge value={signal.direction} /></dd>
            <dt>等级/评分</dt><dd>{signal.level} / {signal.score}</dd>
            <dt>市场模式</dt><dd>{signal.marketRegime}</dd>
            <dt>入场模式</dt><dd>{signal.plan?.entryMode ?? "等待确认"}</dd>
            <dt>入场区</dt><dd>{signal.plan ? `${signal.plan.entryLow} - ${signal.plan.entryHigh}` : "等待确认"}</dd>
            <dt>止损</dt><dd>{signal.plan?.stopLoss ?? "等待确认"}</dd>
            <dt>TP1/TP2/TP3</dt><dd>{signal.plan ? `${signal.plan.tp1} / ${signal.plan.tp2} / ${signal.plan.tp3}` : "等待确认"}</dd>
            <dt>加权 RR</dt><dd>{signal.plan ? `1:${signal.plan.weightedRr.toFixed(1)}` : "等待确认"}</dd>
            <dt>不追价</dt><dd>{signal.plan?.noChasePrice ?? "等待确认"}</dd>
          </dl>
        </section>

        <section className="panel">
          <h2>解释与通知</h2>
          <p>{signal.reasons.join("；")}</p>
          <p>失效条件：{signal.invalidationRules.join("；")}</p>
          <h3>邮件标题</h3>
          <p>{email.subject}</p>
          <h3>正文预览</h3>
          <pre style={{ whiteSpace: "pre-wrap", color: "var(--muted)" }}>{email.body}</pre>
        </section>
      </div>
    </AppShell>
  );
}
