# GPT Signal

专业虚拟货币合约交易机会雷达与风控复盘系统。

当前版本是生产级 SaaS 第一版骨架：Next.js 后台、Supabase 数据库迁移、Binance USD-M Futures 公共行情同步、策略信号引擎、通知记录和保守回测框架。

## 本阶段不做

- 不自动下单
- 不接交易权限 API
- 不读取真实账户资产
- 不承诺收益
- 不把 service role key 暴露给前端

## 本地启动

```bash
npm install
cp .env.example .env.local
npm run dev
```

未配置 Supabase 时，页面会展示样例数据；同步 API 会返回 `persisted: false`。

## 环境变量

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
BINANCE_FUTURES_BASE_URL=https://fapi.binance.com
SIGNAL_SYNC_SECRET=
NOTIFICATION_EMAIL_TO=
NOTIFICATION_EMAIL_FROM=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
```

## Supabase

在 Supabase SQL Editor 或 CLI 中应用：

```text
supabase/migrations/202606230001_initial_schema.sql
```

迁移会创建需求书中的核心表、索引、RLS 和初始策略版本。生产环境应创建后台用户，只让 authenticated 用户访问运营数据。

## Binance 同步

同步接口：

```http
POST /api/jobs/sync-market
```

如果配置了 `SIGNAL_SYNC_SECRET`，请求需要带：

```http
x-signal-sync-secret: <secret>
```

该接口只使用 Binance 公共行情数据，不需要交易 API key。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

## Vercel

把上述环境变量配置到 Vercel Project Settings。Cron 可以配置为定时 POST `/api/jobs/sync-market`；若启用 `SIGNAL_SYNC_SECRET`，建议用外部调度器或 Vercel Cron 包一层带请求头的任务。

