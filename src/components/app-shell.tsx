import Link from "next/link";
import { Activity, Bell, Gauge, LineChart, Radar, Settings, Shield } from "lucide-react";

const items = [
  { href: "/", label: "工作台", icon: Gauge },
  { href: "/radar", label: "机会雷达", icon: Radar },
  { href: "/signals", label: "信号列表", icon: Bell },
  { href: "/backtests", label: "回测", icon: LineChart },
  { href: "/risk", label: "策略风控", icon: Shield },
  { href: "/settings", label: "设置", icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Activity size={20} /> GPT Signal
        </div>
        <nav className="nav">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link href={item.href} key={item.href}>
                <Icon size={16} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}

