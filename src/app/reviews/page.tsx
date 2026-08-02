import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { MetricCard } from "@/components/metric-card";
import { StatusBadge } from "@/components/status-badge";
import { getRecentSignalReviews } from "@/lib/data-access";
import { isSettledReviewStatus } from "@/lib/signal/review";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const reviews = await getRecentSignalReviews(500);
  const production = reviews.filter((review) => review.deliveryMode === "production");
  const shadow = reviews.filter((review) => review.deliveryMode === "shadow");

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <h1 className="page-title">已发复盘</h1>
          <p className="page-subtitle">
            新信号全仓 TP1 结算；同 K 线 SL 优先；未触发 TP/SL 的信号持续持仓，不做时间到期平仓。
            历史旧结果保留原始口径，影子策略不会发送邮件。
          </p>
        </div>
      </header>

      <div className="grid metrics">
        <ReviewMetrics title="生产基线" reviews={production} />
        <ReviewMetrics title="影子候选" reviews={shadow} />
      </div>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>发送时间</th>
              <th>运行模式</th>
              <th>策略版本</th>
              <th>信号</th>
              <th>方向</th>
              <th>状态</th>
              <th>入场</th>
              <th>SL</th>
              <th>TP1 / TP2 / TP3</th>
              <th>结算价</th>
              <th>毛 / 净 P/L</th>
              <th>净 R</th>
              <th>最近检查</th>
            </tr>
          </thead>
          <tbody>
            {reviews.length === 0 ? (
              <tr>
                <td colSpan={13}>暂无复盘数据。运行一次同步后，这里会记录每笔信号的最终结果。</td>
              </tr>
            ) : reviews.map((review) => (
              <tr key={review.id}>
                <td>{formatTime(review.signalSentAt)}</td>
                <td><StatusBadge value={review.deliveryMode === "shadow" ? "影子" : "生产"} /></td>
                <td>{review.strategyVersion ?? "legacy/unknown"}</td>
                <td><Link href={`/signals/${review.signalId}`}>{review.symbol}</Link></td>
                <td><StatusBadge value={review.direction} /></td>
                <td><StatusBadge value={statusLabel(review.status)} /></td>
                <td>{priceRange(review.entryLow, review.entryHigh)}</td>
                <td>{review.stopLoss}</td>
                <td>{review.tp1} / {review.tp2} / {review.tp3}</td>
                <td>{review.exitPrice ?? "-"}</td>
                <td style={{ color: pnlColor(review.netPnlPct) }}>
                  {formatPnl(review.grossPnlPct)} / {formatPnl(review.netPnlPct)}
                </td>
                <td style={{ color: pnlColor(review.netR) }}>{formatPnl(review.netR, " R")}</td>
                <td>{formatTime(review.lastCheckedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

function ReviewMetrics({ title, reviews }: { title: string; reviews: Awaited<ReturnType<typeof getRecentSignalReviews>> }) {
  const settled = reviews.filter((review) => isSettledReviewStatus(review.status));
  const wins = settled.filter((review) => (review.netR ?? 0) > 0).length;
  const losses = settled.filter((review) => (review.netR ?? 0) < 0).length;
  const netR = settled.reduce((sum, review) => sum + (review.netR ?? 0), 0);
  const netPnlPct = settled.reduce((sum, review) => sum + (review.netPnlPct ?? 0), 0);
  const open = reviews.filter((review) => review.status === "open").length;
  const waiting = reviews.filter((review) => review.status === "waiting_entry").length;

  return (
    <div>
      <MetricCard label={`${title}信号`} value={reviews.length} note={`已结算 ${settled.length} · 持仓 ${open} · 待入场 ${waiting}`} />
      <div className="grid metrics" style={{ marginTop: 12 }}>
        <MetricCard label={`${title}净收益率`} value={`${netPnlPct.toFixed(4)}%`} note={`胜 ${wins} / 负 ${losses}`} />
        <MetricCard label={`${title}净 R`} value={netR.toFixed(4)} note="未结算信号不计入" />
      </div>
    </div>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    waiting_entry: "待入场",
    open: "持仓中",
    hit_tp1: "TP1 结算",
    hit_tp2: "TP2 结算（历史）",
    hit_tp3: "TP3 结算（历史）",
    hit_sl: "SL 结算"
  };
  return labels[status] ?? status;
}

function priceRange(low: number, high: number) {
  return low === high ? String(low) : `${low} - ${high}`;
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}

function formatPnl(value: number | null, suffix = "%") {
  return value === null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(4)}${suffix}`;
}

function pnlColor(value: number | null) {
  if (value === null) return "var(--muted)";
  return value >= 0 ? "var(--green)" : "var(--red)";
}
