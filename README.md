# Unified Admin Panel

Vue 3 + TypeScript + Naive UI admin panel for unified account visibility and management across:

- `CLIProxyAPI`
- `sub2api`

## Implemented Features

- Theme switch (`light` / `dark`) with local persistence
- Full-screen dashboard layout with fixed left navigation
- Platform config panel (base URL + API key + enabled)
- API key stored in browser `localStorage` (no redeploy required when key changes)
- Built-in same-origin proxy endpoint (`/api/proxy`) for CORS-safe API calls (Cloudflare Pages Functions + Vite dev middleware)
- Per-platform connection test
- Unified account table with:
  - search/filter
  - row-level actions (detail / edit / enable-disable)
  - multi-select batch actions
- ECharts-based usage trend line chart (sub2api + cpa)
- Account detail modal:
  - profile payload
  - usage/stats payload
  - models payload
  - auto refresh
- Management actions:
  - single enable/disable
  - single field edit
  - batch enable/disable
  - batch field edit (with platform capability-aware handling)
- Cloudflare Pages deploy config (`wrangler.toml` + SPA `_redirects`)

## Componentized Structure

The UI is decoupled into reusable components:

- `src/components/AppHeader.vue`
- `src/components/SidebarNav.vue`
- `src/components/PlatformConfigPanel.vue`
- `src/components/AccountStatsGrid.vue`
- `src/components/PlatformTrendChart.vue`
- `src/components/AccountTable.vue`
- `src/components/AccountDetailModal.vue`
- `src/components/EditAccountModal.vue`
- `src/components/BatchEditModal.vue`

Core API orchestration:

- `src/services/platformClients.ts`

## API integration implemented

### 1) CLIProxyAPI

- Endpoint: `GET /v0/management/auth-files`
- Auth headers:
  - `Authorization: Bearer <key>`
  - `X-Management-Key: <key>`
- Source mapping: `internal/api/server.go` + `internal/api/handlers/management/auth_files.go`

### 2) sub2api

- Endpoint: `GET /api/v1/admin/accounts?page=1&page_size=300`
- Auth headers:
  - `x-api-key: <key>`
  - `Authorization: Bearer <key>` (fallback path)
- Source mapping: `backend/internal/server/routes/admin.go` + `backend/internal/server/middleware/admin_auth.go` + `backend/internal/handler/admin/account_handler.go`

## Local run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Deploy to Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy dist --project-name unified-admin-panel
```

## Notes

- By default, requests use `POST /api/proxy` to avoid browser cross-origin issues.
- Optional request mode override:
  - `localStorage.setItem("unified-admin-panel.request-mode", "direct")`
  - `localStorage.setItem("unified-admin-panel.request-mode", "proxy")`
