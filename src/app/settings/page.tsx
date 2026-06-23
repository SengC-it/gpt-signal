import { AppShell } from "@/components/app-shell";

export default function SettingsPage() {
  const envRows = [
    ["NEXT_PUBLIC_SUPABASE_URL", "Supabase 项目 URL"],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "前端匿名 publishable key"],
    ["SUPABASE_SERVICE_ROLE_KEY", "服务端写入 key，不允许暴露到前端"],
    ["SIGNAL_SYNC_SECRET", "定时同步 API 保护密钥"],
    ["NOTIFICATION_EMAIL_TO", "通知收件人"]
  ];

  return (
    <AppShell>
      <header className="page-header">
        <div>
          <h1 className="page-title">系统设置</h1>
          <p className="page-subtitle">生产部署前需要配置这些环境变量。</p>
        </div>
      </header>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>环境变量</th><th>用途</th></tr>
          </thead>
          <tbody>
            {envRows.map(([key, value]) => (
              <tr key={key}><td>{key}</td><td>{value}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

