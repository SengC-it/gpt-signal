export function StatusBadge({ value }: { value: string }) {
  const color = value.includes("S") || value.includes("正常") || value.includes("planned")
    ? "green"
    : value.includes("A") || value.includes("trend")
      ? "blue"
      : value.includes("B") || value.includes("观察") || value.includes("watching")
        ? "yellow"
        : value.includes("SHORT") || value.includes("风险")
          ? "red"
          : "";

  return <span className={`badge ${color}`}>{value}</span>;
}

