# 统一账号额度面板

基于 Vue 3 + TypeScript + Naive UI 的管理面板，用于统一查看和管理以下平台的账号：

- `CLIProxyAPI`（CPA）
- `sub2api`

## 已实现功能

- 主题切换（浅色 / 深色），偏好保存在本地
- 全屏仪表盘布局，支持 Sub2API / CPA 分栏展示
- 配置中心：主页模块显示开关、卡片排序、连接测试（地址与 Key 由 Cloudflare 环境变量提供）
- 内置同源代理接口（`POST /api/proxy`），避免浏览器跨域（Cloudflare Pages Functions + Vite 开发中间件）
- 账号额度卡片：5h / 7d 窗口、进度条、批量选择与编辑
- 右键查看账号 JSON（语法高亮、可折叠、行号）
- 管理操作：单个/批量启停、批量编辑、批量按邮箱重命名（Sub2API）
- Cloudflare Workers 部署配置（`wrangler.toml` + 静态资源 `dist`）

## 组件结构

主要 UI 组件：

- `src/App.vue` — 主界面、分栏、批量操作
- `src/components/FloatingConfigModal.vue` — 配置中心
- `src/components/AccountQuotaCard.vue` — 账号额度行
- `src/components/AccountManageModals.vue` — 批量编辑 / 重命名
- `src/components/AccountJsonModal.vue` — JSON 查看
- `src/components/JsonFoldViewer.vue` — 可折叠 JSON 展示

核心 API 封装：

- `src/services/platformClients.ts`
- `src/utils/quotaCard.ts` — 额度与 5h/7d 解析

Cloudflare Functions：

- `functions/api/config.ts` — 下发平台地址与 Key
- `functions/api/proxy.ts` — 请求代理

## 已对接的 API

### 1）CLIProxyAPI

- 接口：`GET /v0/management/auth-files`
- 认证头：
  - `Authorization: Bearer <key>`
  - `X-Management-Key: <key>`

### 2）sub2api

- 接口：`GET /api/v1/admin/accounts?page=1&page_size=300`
- 账号额度：`GET /api/v1/admin/accounts/{id}/usage?timezone=Asia/Shanghai`
- 认证头：
  - `x-api-key: <key>`
  - `Authorization: Bearer <key>`（备用）

## 本地运行

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动：

- **wrangler dev**（`127.0.0.1:8787`）— 提供 `/api/config`、`/api/proxy`，读取 `wrangler.toml` 与 Cloudflare 密钥（与线上一致）
- **Vite**（`5173`）— 前端热更新，并将 `/api/*` 代理到 Worker

平台地址与 API Key **仅**来自 Cloudflare 配置（`wrangler.toml` 的 `[vars]` + 控制台 Variables/Secrets，或 `wrangler secret put`），不再读取本地 `.env` / `.env.local`。

本地调试若需与线上相同的密钥，可使用 `wrangler dev --remote`（在 `package.json` 的 `dev:worker` 脚本中自行加上 `--remote`）。

若出现 `sub2api: 未配置 API Key...`，请在 Cloudflare 控制台或 `wrangler secret put SUB2API_API_KEY` 中配置密钥。

## 构建

```bash
npm run build
npm run preview
```

## 部署到 Cloudflare

```bash
npm run build
npx wrangler deploy
```

或在 Cloudflare 控制台连接 Git 仓库自动构建部署。

### 环境变量（在 Cloudflare 控制台配置）

| 变量 | 说明 |
|------|------|
| `CPA_BASE_URL` / `CLIPROXYAPI_BASE_URL` | CLIProxyAPI 地址 |
| `CPA_API_KEY` / `CLIPROXYAPI_API_KEY` | CLIProxyAPI Key |
| `SUB2API_BASE_URL` | sub2api 地址 |
| `SUB2API_API_KEY` | sub2api Key |

`wrangler.toml` 的 `[vars]` 可写默认地址；**API Key 必须用加密变量**（控制台 Variables / Secrets，或 `npx wrangler secret put SUB2API_API_KEY`），不要写入 Git。

未配置 `SUB2API_API_KEY` 时，Sub2API 模块会报错且无法拉取账号列表。

### 本地仅保存的配置

浏览器 `localStorage` 仅保存：

- 各平台是否在主页显示（`enabled`）
- 排序字段与方向
- 主题、自动刷新间隔等 UI 偏好

**不再**在本地保存平台地址或 API Key。

## 说明

- 默认通过 `POST /api/proxy` 转发 API 请求，避免跨域。
- 可选请求模式（浏览器控制台）：
  - `localStorage.setItem("unified-admin-panel.request-mode", "direct")` — 直连
  - `localStorage.setItem("unified-admin-panel.request-mode", "proxy")` — 走代理（默认）
- 刷新数据时，对每个需展示额度的账号并行请求 `usage`（最多 100 并发），不请求 `stats?days=30`。
- `unknown` 计划类型账号排在列表末尾，卡片上不显示 5h/7d 额度条（仍会请求 usage 数据）。
