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
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
```

### Gmail 邮件通知

如果要用 Gmail 发通知，建议使用 Gmail App Password，不要使用 Google 账号主密码。

需要配置：

```text
NOTIFICATION_EMAIL_TO=接收通知的邮箱
NOTIFICATION_EMAIL_FROM=你的 Gmail 地址
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=你的 Gmail 地址
SMTP_PASS=Gmail App Password
```

发送失败不会中断行情同步；通知会写入 `gpt_notifications`，状态会标记为 `sent`、`failed` 或 `queued`。同一轮同步如果产生多条信号，只会发送一封汇总邮件，邮件内按评分从高到低排列。

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

把上述环境变量配置到 Vercel Project Settings。

## GitHub Actions 定时触发

仓库包含 `.github/workflows/sync-market.yml`，默认每 15 分钟触发一次生产同步接口，也支持在 GitHub Actions 页面手动运行。

需要在 GitHub 仓库设置中添加：

```text
Secret: GPT_SIGNAL_SYNC_SECRET = Vercel 里的 SIGNAL_SYNC_SECRET
```

可选添加：

```text
Variable: GPT_SIGNAL_SYNC_URL = https://gpt-signal.vercel.app/api/jobs/sync-market
```

如果不配置 `GPT_SIGNAL_SYNC_URL`，workflow 会默认请求 `https://gpt-signal.vercel.app/api/jobs/sync-market`。
