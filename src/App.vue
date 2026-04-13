<script setup lang="ts">
import { SettingsOutline } from "@vicons/ionicons5";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createDiscreteApi,
  darkTheme,
  dateZhCN,
  NButton,
  NConfigProvider,
  NIcon,
  NScrollbar,
  NSelect,
  NSpace,
  zhCN
} from "naive-ui";
import AccountQuotaCard from "./components/AccountQuotaCard.vue";
import FloatingConfigModal from "./components/FloatingConfigModal.vue";
import {
  fetchAccountsForPlatform,
  fetchUnifiedAccounts,
  sanitizeBaseUrl
} from "./services/platformClients";
import type { PlatformConfig, PlatformKind, UnifiedAccount } from "./types/platform";
import type {
  PlatformSortSettings,
  SortDirection,
  SortField
} from "./types/viewSettings";
import {
  buildAccountQuotaMetrics,
  type QuotaCardMetrics
} from "./utils/quotaCard";

const PLATFORM_STORAGE_KEY = "unified-admin-panel.platforms";
const SORT_STORAGE_KEY = "unified-admin-panel.sort-settings";
const THEME_STORAGE_KEY = "unified-admin-panel.theme";
const AUTO_REFRESH_STORAGE_KEY = "unified-admin-panel.auto-refresh-seconds";
const SPLIT_RATIO_STORAGE_KEY = "unified-admin-panel.split-ratio";

type FeedbackType = "success" | "warning" | "error";
type AccountStateKind = "normal" | "exhausted" | "disabled" | "error";

const autoRefreshOptions = [
  { label: "自动刷新：关闭", value: 0 },
  { label: "自动刷新：15秒", value: 15 },
  { label: "自动刷新：30秒", value: 30 },
  { label: "自动刷新：60秒", value: 60 }
];

const defaultPlatforms: PlatformConfig[] = [
  {
    id: "cliproxyapi",
    name: "cpa",
    baseUrl: "",
    apiKey: "",
    enabled: true
  },
  {
    id: "sub2api",
    name: "sub2api",
    baseUrl: "",
    apiKey: "",
    enabled: true
  }
];

const defaultSortSettings: PlatformSortSettings = {
  sub2api: {
    field: "priority",
    direction: "asc"
  },
  cliproxyapi: {
    field: "priority",
    direction: "asc"
  }
};

function cloneDefaultPlatforms(): PlatformConfig[] {
  return defaultPlatforms.map((item) => ({ ...item }));
}

function cloneDefaultSortSettings(): PlatformSortSettings {
  return {
    sub2api: { ...defaultSortSettings.sub2api },
    cliproxyapi: { ...defaultSortSettings.cliproxyapi }
  };
}

function isPlatformConfigArray(value: unknown): value is PlatformConfig[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const candidate = item as PlatformConfig;
    return (
      (candidate.id === "cliproxyapi" || candidate.id === "sub2api") &&
      typeof candidate.name === "string" &&
      typeof candidate.baseUrl === "string" &&
      typeof candidate.apiKey === "string" &&
      typeof candidate.enabled === "boolean"
    );
  });
}

function isSortField(value: unknown): value is SortField {
  return [
    "name",
    "priority",
    "totalQuota",
    "usedQuota",
    "remainingPercent",
    "updatedAt"
  ].includes(String(value));
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc";
}

function loadPlatforms(): PlatformConfig[] {
  try {
    const raw = localStorage.getItem(PLATFORM_STORAGE_KEY);
    if (!raw) {
      return cloneDefaultPlatforms();
    }
    const parsed = JSON.parse(raw);
    if (!isPlatformConfigArray(parsed)) {
      return cloneDefaultPlatforms();
    }

    const defaults = cloneDefaultPlatforms();
    for (const item of parsed) {
      const target = defaults.find((entry) => entry.id === item.id);
      if (!target) {
        continue;
      }
      target.baseUrl = item.baseUrl;
      target.apiKey = item.apiKey;
      target.enabled = item.enabled;
    }
    return defaults;
  } catch {
    return cloneDefaultPlatforms();
  }
}

function loadSortSettings(): PlatformSortSettings {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) {
      return cloneDefaultSortSettings();
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const defaults = cloneDefaultSortSettings();
    for (const platformId of ["sub2api", "cliproxyapi"] as PlatformKind[]) {
      const rule = parsed[platformId];
      if (!rule || typeof rule !== "object") {
        continue;
      }
      const candidate = rule as Record<string, unknown>;
      if (isSortField(candidate.field)) {
        defaults[platformId].field = candidate.field;
      }
      if (isSortDirection(candidate.direction)) {
        defaults[platformId].direction = candidate.direction;
      }
    }
    return defaults;
  } catch {
    return cloneDefaultSortSettings();
  }
}

function loadThemeMode(): "light" | "dark" {
  return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

function loadAutoRefreshSeconds(): number {
  const raw = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
  if (!raw) {
    return 30;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || ![0, 15, 30, 60].includes(parsed)) {
    return 30;
  }
  return parsed;
}

function loadSplitRatio(): number {
  const raw = localStorage.getItem(SPLIT_RATIO_STORAGE_KEY);
  if (!raw) {
    return 50;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.max(20, Math.min(80, parsed));
}

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "未知错误";
}

function applyThemeToDocument(themeMode: "light" | "dark"): void {
  document.documentElement.setAttribute("data-theme", themeMode);
}

const platforms = ref<PlatformConfig[]>(loadPlatforms());
const sortSettings = ref<PlatformSortSettings>(loadSortSettings());
const themeMode = ref<"light" | "dark">(loadThemeMode());
const autoRefreshSeconds = ref<number>(loadAutoRefreshSeconds());
const splitRatio = ref<number>(loadSplitRatio());

const loading = ref(false);
const refreshing = ref(false);
const showConfigModal = ref(false);
const isDraggingDivider = ref(false);

const testLoading = ref<Record<PlatformKind, boolean>>({
  cliproxyapi: false,
  sub2api: false
});
const checkMessages = ref<Record<PlatformKind, string>>({
  cliproxyapi: "",
  sub2api: ""
});

const accounts = ref<UnifiedAccount[]>([]);
const errors = ref<string[]>([]);

const splitContainerRef = ref<HTMLElement | null>(null);

const isDark = computed(() => themeMode.value === "dark");
const themeOverrides = {
  common: {
    primaryColor: "#0f766e",
    primaryColorHover: "#0d9488",
    primaryColorPressed: "#115e59"
  }
};

function notify(type: FeedbackType, message: string): void {
  const { notification } = createDiscreteApi(["notification"], {
    configProviderProps: {
      theme: isDark.value ? darkTheme : undefined,
      themeOverrides,
      locale: zhCN,
      dateLocale: dateZhCN
    }
  });
  notification[type]({
    title: type === "success" ? "操作成功" : type === "warning" ? "提示" : "操作失败",
    content: message,
    duration: type === "error" ? 4500 : 3200,
    keepAliveOnHover: true
  });
}

function persistPlatforms(): void {
  localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(platforms.value));
}

function persistSortSettings(): void {
  localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sortSettings.value));
}

function saveSettings(options?: { silent?: boolean }): void {
  for (const platform of platforms.value) {
    platform.baseUrl = sanitizeBaseUrl(platform.baseUrl);
    platform.apiKey = platform.apiKey.trim();
  }
  persistPlatforms();
  persistSortSettings();
  if (!options?.silent) {
    notify("success", "配置已保存。");
  }
}

function updatePlatformField(payload: {
  platformId: PlatformKind;
  key: "baseUrl" | "apiKey" | "enabled";
  value: string | boolean;
}): void {
  const target = platforms.value.find((item) => item.id === payload.platformId);
  if (!target) {
    return;
  }
  if (payload.key === "enabled") {
    target.enabled = Boolean(payload.value);
    return;
  }
  target[payload.key] = String(payload.value);
}

function updateSortSetting(payload: {
  platformId: PlatformKind;
  key: "field" | "direction";
  value: SortField | SortDirection;
}): void {
  const target = sortSettings.value[payload.platformId];
  if (!target) {
    return;
  }
  if (payload.key === "field" && isSortField(payload.value)) {
    target.field = payload.value;
  }
  if (payload.key === "direction" && isSortDirection(payload.value)) {
    target.direction = payload.value;
  }
}

function getPlatformConfig(platformId: PlatformKind): PlatformConfig {
  const platform = platforms.value.find((item) => item.id === platformId);
  if (!platform) {
    throw new Error(`未找到平台配置：${platformId}`);
  }
  return platform;
}

function detectErrorPlatforms(errorMessages: string[]): Set<PlatformKind> {
  const set = new Set<PlatformKind>();
  for (const message of errorMessages) {
    const normalized = message.toLowerCase();
    for (const platform of platforms.value) {
      const platformName = platform.name.toLowerCase();
      const platformId = platform.id.toLowerCase();
      if (normalized.includes(platformName) || normalized.includes(platformId)) {
        set.add(platform.id);
      }
    }
  }
  return set;
}

function sortAccountsByDefault(list: UnifiedAccount[]): UnifiedAccount[] {
  return [...list].sort(
    (a, b) =>
      a.platformName.localeCompare(b.platformName) ||
      a.name.localeCompare(b.name)
  );
}

function mergeAccountsWithFallback(
  nextAccounts: UnifiedAccount[],
  errorMessages: string[]
): UnifiedAccount[] {
  const erroredPlatforms = detectErrorPlatforms(errorMessages);
  if (!erroredPlatforms.size) {
    return nextAccounts;
  }

  const previousByPlatform = new Map<PlatformKind, UnifiedAccount[]>();
  const nextByPlatform = new Map<PlatformKind, UnifiedAccount[]>();

  for (const account of accounts.value) {
    if (!previousByPlatform.has(account.platform)) {
      previousByPlatform.set(account.platform, []);
    }
    previousByPlatform.get(account.platform)?.push(account);
  }

  for (const account of nextAccounts) {
    if (!nextByPlatform.has(account.platform)) {
      nextByPlatform.set(account.platform, []);
    }
    nextByPlatform.get(account.platform)?.push(account);
  }

  const merged: UnifiedAccount[] = [];
  for (const platformId of ["sub2api", "cliproxyapi"] as PlatformKind[]) {
    const nextList = nextByPlatform.get(platformId) ?? [];
    if (nextList.length > 0) {
      merged.push(...nextList);
      continue;
    }
    if (erroredPlatforms.has(platformId)) {
      const previousList = previousByPlatform.get(platformId) ?? [];
      if (previousList.length > 0) {
        merged.push(...previousList);
      }
    }
  }

  if (!merged.length) {
    return nextAccounts;
  }
  return sortAccountsByDefault(merged);
}

async function refreshAccounts(options?: { silent?: boolean }): Promise<void> {
  if (refreshing.value) {
    return;
  }
  saveSettings({ silent: true });
  refreshing.value = true;
  if (!options?.silent) {
    loading.value = true;
  }
  try {
    const result = await fetchUnifiedAccounts(platforms.value);
    const mergedAccounts = mergeAccountsWithFallback(result.accounts, result.errors);
    const shouldKeepOldSnapshot =
      mergedAccounts.length === 0 &&
      accounts.value.length > 0 &&
      result.errors.length > 0;
    if (!shouldKeepOldSnapshot) {
      accounts.value = mergedAccounts;
    }
    errors.value = result.errors;
    if (errors.value.length && !options?.silent) {
      notify("warning", errors.value.slice(0, 2).join("；"));
    }
  } catch (error) {
    const message = parseErrorMessage(error);
    errors.value = [message];
    if (!options?.silent) {
      notify("error", message);
    }
  } finally {
    refreshing.value = false;
    loading.value = false;
  }
}

async function testConnection(platformId: PlatformKind): Promise<void> {
  const platform = getPlatformConfig(platformId);
  saveSettings({ silent: true });
  testLoading.value[platformId] = true;
  checkMessages.value[platformId] = "";
  const result = await fetchAccountsForPlatform(platform);
  checkMessages.value[platformId] = result.error
    ? result.error
    : `已拉取 ${result.accounts.length} 条账号记录。`;
  testLoading.value[platformId] = false;
}

function copyTextBySelection(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const success = document.execCommand("copy");
  document.body.removeChild(textarea);
  return success;
}

async function handleCopyEmail(email: string): Promise<void> {
  const normalized = email.trim();
  if (!normalized) {
    notify("warning", "该账号没有可复制的邮箱。");
    return;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(normalized);
    } else {
      const ok = copyTextBySelection(normalized);
      if (!ok) {
        throw new Error("复制失败");
      }
    }
    notify("success", `已复制邮箱：${normalized}`);
  } catch {
    notify("error", "复制失败，请检查浏览器权限。");
  }
}

function toggleTheme(): void {
  themeMode.value = themeMode.value === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, themeMode.value);
  applyThemeToDocument(themeMode.value);
}

const quotaMetricsMap = computed<Map<string, QuotaCardMetrics>>(() => {
  const map = new Map<string, QuotaCardMetrics>();
  for (const account of accounts.value) {
    map.set(account.uid, buildAccountQuotaMetrics(account));
  }
  return map;
});

function getMetrics(account: UnifiedAccount): QuotaCardMetrics {
  return (
    quotaMetricsMap.value.get(account.uid) ?? {
      totalText: "-",
      usedText: "-",
      exhausted: false
    }
  );
}

function formatQuotaValue(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  if (Math.abs(value) >= 1000) {
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  return `$${value.toFixed(2)}`;
}

function summarizeQuotaTotals(list: UnifiedAccount[]): {
  count: number;
  max?: number;
  min?: number;
  avg?: number;
} {
  const totals = list
    .map((account) => getMetrics(account).usdQuotaValue)
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value > 0
    );
  if (!totals.length) {
    return {
      count: 0,
      max: undefined,
      min: undefined,
      avg: undefined
    };
  }
  return {
    count: totals.length,
    max: Math.max(...totals),
    min: Math.min(...totals),
    avg: totals.reduce((sum, value) => sum + value, 0) / totals.length
  };
}

function resolveAccountState(account: UnifiedAccount): AccountStateKind {
  const metrics = getMetrics(account);
  if (metrics.exhausted) {
    return "exhausted";
  }

  const normalized = account.status.trim().toLowerCase();
  if (normalized.includes("rate_limited") || normalized.includes("rate limit")) {
    return "exhausted";
  }
  if (normalized.includes("inactive") || normalized.includes("disabled")) {
    return "disabled";
  }
  if (
    normalized.includes("error") ||
    normalized.includes("invalid") ||
    normalized.includes("banned") ||
    normalized.includes("failed")
  ) {
    return "error";
  }
  if (
    normalized.includes("quota_exhausted") ||
    normalized.includes("usage_limit_reached") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("quota exhausted")
  ) {
    return "exhausted";
  }
  return "normal";
}

function summarizeAccountStates(list: UnifiedAccount[]): Record<AccountStateKind, number> {
  const summary: Record<AccountStateKind, number> = {
    normal: 0,
    exhausted: 0,
    disabled: 0,
    error: 0
  };
  for (const account of list) {
    summary[resolveAccountState(account)] += 1;
  }
  return summary;
}

function getSortValue(
  account: UnifiedAccount,
  field: SortField
): number | string | undefined {
  const metrics = getMetrics(account);
  if (field === "name") {
    return account.name.toLowerCase();
  }
  if (field === "priority") {
    return account.priority;
  }
  if (field === "totalQuota") {
    return metrics.totalValue;
  }
  if (field === "usedQuota") {
    return metrics.usedValue;
  }
  if (field === "remainingPercent") {
    return metrics.remainingPercent;
  }
  if (!account.updatedAt) {
    return undefined;
  }
  const timestamp = new Date(account.updatedAt).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function sortPlatformAccounts(
  list: UnifiedAccount[],
  rule: PlatformSortSettings[PlatformKind]
): UnifiedAccount[] {
  const factor = rule.direction === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const aValue = getSortValue(a, rule.field);
    const bValue = getSortValue(b, rule.field);
    const aMissing = typeof aValue === "undefined";
    const bMissing = typeof bValue === "undefined";

    if (aMissing && bMissing) {
      return a.name.localeCompare(b.name, "zh-Hans-CN", {
        sensitivity: "base"
      });
    }
    if (aMissing) {
      return 1;
    }
    if (bMissing) {
      return -1;
    }

    let compareValue = 0;
    if (typeof aValue === "number" && typeof bValue === "number") {
      compareValue = aValue - bValue;
    } else {
      compareValue = String(aValue).localeCompare(String(bValue), "zh-Hans-CN", {
        numeric: true,
        sensitivity: "base"
      });
    }

    if (compareValue === 0) {
      compareValue = a.name.localeCompare(b.name, "zh-Hans-CN", {
        sensitivity: "base"
      });
    }

    return compareValue * factor;
  });
}

const sub2apiAccounts = computed(() => {
  const list = accounts.value.filter((item) => item.platform === "sub2api");
  return sortPlatformAccounts(list, sortSettings.value.sub2api);
});

const cpaAccounts = computed(() => {
  const list = accounts.value.filter((item) => item.platform === "cliproxyapi");
  return sortPlatformAccounts(list, sortSettings.value.cliproxyapi);
});

const sub2apiStateSummary = computed(() => summarizeAccountStates(sub2apiAccounts.value));
const cpaStateSummary = computed(() => summarizeAccountStates(cpaAccounts.value));
const sub2apiQuotaSummary = computed(() => summarizeQuotaTotals(sub2apiAccounts.value));
const cpaQuotaSummary = computed(() => summarizeQuotaTotals(cpaAccounts.value));

const leftPaneStyle = computed(() => ({
  flexBasis: `${splitRatio.value}%`
}));
const rightPaneStyle = computed(() => ({
  flexBasis: `${100 - splitRatio.value}%`
}));

function updateSplitByClientX(clientX: number): void {
  const container = splitContainerRef.value;
  if (!container) {
    return;
  }
  const rect = container.getBoundingClientRect();
  if (rect.width <= 0) {
    return;
  }
  const next = ((clientX - rect.left) / rect.width) * 100;
  splitRatio.value = Math.max(20, Math.min(80, next));
}

function stopDividerDrag(): void {
  if (!isDraggingDivider.value) {
    return;
  }
  isDraggingDivider.value = false;
  window.removeEventListener("pointermove", handleDividerPointerMove);
  window.removeEventListener("pointerup", stopDividerDrag);
}

function handleDividerPointerMove(event: PointerEvent): void {
  if (!isDraggingDivider.value) {
    return;
  }
  updateSplitByClientX(event.clientX);
}

function startDividerDrag(event: PointerEvent): void {
  if (window.innerWidth <= 980) {
    return;
  }
  isDraggingDivider.value = true;
  updateSplitByClientX(event.clientX);
  window.addEventListener("pointermove", handleDividerPointerMove);
  window.addEventListener("pointerup", stopDividerDrag);
}

function adjustSplitByKeyboard(delta: number): void {
  splitRatio.value = Math.max(20, Math.min(80, splitRatio.value + delta));
}

let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

function resetAutoRefreshTimer(): void {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (autoRefreshSeconds.value <= 0) {
    return;
  }
  autoRefreshTimer = setInterval(() => {
    void refreshAccounts({ silent: true });
  }, autoRefreshSeconds.value * 1000);
}

watch(autoRefreshSeconds, (value) => {
  localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(value));
  resetAutoRefreshTimer();
});

watch(themeMode, (value) => {
  applyThemeToDocument(value);
});

watch(splitRatio, (value) => {
  localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, String(value));
});

onMounted(() => {
  applyThemeToDocument(themeMode.value);
  void refreshAccounts();
  resetAutoRefreshTimer();
});

onBeforeUnmount(() => {
  stopDividerDrag();
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
});
</script>

<template>
  <NConfigProvider
    :theme="isDark ? darkTheme : undefined"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <div class="app-shell">
      <header class="app-toolbar">
        <div class="app-toolbar__title">
          <h1>账号额度面板</h1>
          <p>左侧 sub2api，右侧 cpa，卡片按配置规则排序</p>
        </div>
        <NSpace align="center" wrap>
          <NSelect
            :value="autoRefreshSeconds"
            :options="autoRefreshOptions"
            style="width: 170px"
            @update:value="(value) => (autoRefreshSeconds = value)"
          />
          <NButton type="primary" :loading="loading" @click="refreshAccounts()">
            刷新数据
          </NButton>
          <NButton tertiary @click="toggleTheme">
            {{ isDark ? "切换浅色" : "切换深色" }}
          </NButton>
        </NSpace>
      </header>

      <p v-if="errors.length" class="error-strip">
        {{ errors[0] }}
      </p>

      <main
        ref="splitContainerRef"
        class="account-split"
        :class="{ 'account-split--dragging': isDraggingDivider }"
      >
        <section class="platform-pane" :style="leftPaneStyle">
          <div class="platform-pane__head">
            <h2>sub2api</h2>
            <div class="platform-pane__head-meta">
              <span class="platform-pane__total">{{ sub2apiAccounts.length }} 个账号</span>
              <div class="platform-pane__status-list">
                <span class="status-chip status-chip--normal">正常 {{ sub2apiStateSummary.normal }}</span>
                <span class="status-chip status-chip--exhausted">用尽 {{ sub2apiStateSummary.exhausted }}</span>
                <span class="status-chip status-chip--disabled">停用 {{ sub2apiStateSummary.disabled }}</span>
                <span class="status-chip status-chip--error">异常 {{ sub2apiStateSummary.error }}</span>
              </div>
              <div class="platform-pane__quota-list">
                <span class="quota-chip">高 {{ formatQuotaValue(sub2apiQuotaSummary.max) }}</span>
                <span class="quota-chip">低 {{ formatQuotaValue(sub2apiQuotaSummary.min) }}</span>
                <span class="quota-chip">均 {{ formatQuotaValue(sub2apiQuotaSummary.avg) }}</span>
              </div>
            </div>
          </div>
          <NScrollbar class="pane-scroll">
            <div class="card-grid">
              <AccountQuotaCard
                v-for="account in sub2apiAccounts"
                :key="account.uid"
                :account="account"
                :metrics="getMetrics(account)"
                @copy-email="handleCopyEmail"
              />
              <p v-if="!sub2apiAccounts.length" class="pane-empty">暂无账号</p>
            </div>
          </NScrollbar>
        </section>

        <div
          class="split-divider"
          role="separator"
          aria-orientation="vertical"
          tabindex="0"
          @pointerdown="startDividerDrag"
          @keydown.left.prevent="adjustSplitByKeyboard(-2)"
          @keydown.right.prevent="adjustSplitByKeyboard(2)"
        >
          <span class="split-divider__dot" />
        </div>

        <section class="platform-pane" :style="rightPaneStyle">
          <div class="platform-pane__head">
            <h2>cpa</h2>
            <div class="platform-pane__head-meta">
              <span class="platform-pane__total">{{ cpaAccounts.length }} 个账号</span>
              <div class="platform-pane__status-list">
                <span class="status-chip status-chip--normal">正常 {{ cpaStateSummary.normal }}</span>
                <span class="status-chip status-chip--exhausted">用尽 {{ cpaStateSummary.exhausted }}</span>
                <span class="status-chip status-chip--disabled">停用 {{ cpaStateSummary.disabled }}</span>
                <span class="status-chip status-chip--error">异常 {{ cpaStateSummary.error }}</span>
              </div>
              <div class="platform-pane__quota-list">
                <span class="quota-chip">高 {{ formatQuotaValue(cpaQuotaSummary.max) }}</span>
                <span class="quota-chip">低 {{ formatQuotaValue(cpaQuotaSummary.min) }}</span>
                <span class="quota-chip">均 {{ formatQuotaValue(cpaQuotaSummary.avg) }}</span>
              </div>
            </div>
          </div>
          <NScrollbar class="pane-scroll">
            <div class="card-grid">
              <AccountQuotaCard
                v-for="account in cpaAccounts"
                :key="account.uid"
                :account="account"
                :metrics="getMetrics(account)"
                @copy-email="handleCopyEmail"
              />
              <p v-if="!cpaAccounts.length" class="pane-empty">暂无账号</p>
            </div>
          </NScrollbar>
        </section>
      </main>

      <NButton
        class="floating-config-button"
        type="primary"
        circle
        size="large"
        @click="showConfigModal = true"
      >
        <template #icon>
          <NIcon size="22">
            <SettingsOutline />
          </NIcon>
        </template>
      </NButton>

      <FloatingConfigModal
        :show="showConfigModal"
        :platforms="platforms"
        :test-loading="testLoading"
        :check-messages="checkMessages"
        :sort-settings="sortSettings"
        @update:show="(value) => (showConfigModal = value)"
        @update-platform-field="updatePlatformField"
        @update-sort-setting="updateSortSetting"
        @save-settings="saveSettings"
        @test-platform="testConnection"
      />
    </div>
  </NConfigProvider>
</template>
