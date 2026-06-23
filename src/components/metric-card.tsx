export function MetricCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <section className="panel">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      {note ? <div className="metric-note">{note}</div> : null}
    </section>
  );
}

