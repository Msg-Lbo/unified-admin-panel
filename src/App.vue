<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createDiscreteApi,
  darkTheme,
  dateZhCN,
  zhCN,
  NButton,
  NCard,
  NConfigProvider,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NSelect,
  NSpace,
  type DataTableRowKey,
  type MenuOption
} from "naive-ui";
import SidebarNav from "./components/SidebarNav.vue";
import PlatformConfigPanel from "./components/PlatformConfigPanel.vue";
import AccountStatsGrid from "./components/AccountStatsGrid.vue";
import PlatformTrendChart from "./components/PlatformTrendChart.vue";
import PlatformQuotaSummaryGrid from "./components/PlatformQuotaSummaryGrid.vue";
import AccountTable from "./components/AccountTable.vue";
import AccountDetailModal from "./components/AccountDetailModal.vue";
import EditAccountModal from "./components/EditAccountModal.vue";
import BatchEditModal from "./components/BatchEditModal.vue";
import {
  batchSetAccountsEnabled,
  batchUpdateAccountFields,
  fetchAccountDetail,
  fetchAccountsForPlatform,
  fetchPlatformUsageTrend,
  fetchUnifiedAccounts,
  sanitizeBaseUrl,
  setAccountEnabled,
  updateAccountEditableFields
} from "./services/platformClients";
import { buildPlatformQuotaSummary } from "./utils/quotaSummary";
import type {
  AccountDetailResult,
  PlatformConfig,
  PlatformKind,
  PlatformUsageTrend,
  UnifiedAccount
} from "./types/platform";

const PLATFORM_STORAGE_KEY = "unified-admin-panel.platforms";
const THEME_STORAGE_KEY = "unified-admin-panel.theme";
const AUTO_REFRESH_STORAGE_KEY = "unified-admin-panel.auto-refresh-seconds";

type FeedbackType = "success" | "warning" | "error";
type ViewKey = "dashboard" | "accounts" | "config" | "about";

const autoRefreshOptions = [
  { label: "自动刷新：关闭", value: 0 },
  { label: "自动刷新：15秒", value: 15 },
  { label: "自动刷新：30秒", value: 30 },
  { label: "自动刷新：60秒", value: 60 }
];

const detailRefreshOptions = [
  { label: "15秒", value: 15 },
  { label: "30秒", value: 30 },
  { label: "60秒", value: 60 }
];

const menuOptions: MenuOption[] = [
  { label: "仪表盘", key: "dashboard" },
  {
    label: "账号管理",
    key: "accounts",
    children: [
      { label: "sub2api", key: "accounts-sub2api" },
      { label: "cpa", key: "accounts-cpa" }
    ]
  },
  { label: "配置", key: "config" },
  { label: "关于", key: "about" }
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

function cloneDefaultPlatforms(): PlatformConfig[] {
  return defaultPlatforms.map((item) => ({ ...item }));
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

function parseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "未知错误";
}

function normalizeForSearch(value: string): string {
  return value.trim().toLowerCase();
}

function classifyStatus(status: string): "healthy" | "warning" | "error" {
  const normalized = normalizeForSearch(status);
  if (
    normalized.includes("error") ||
    normalized.includes("invalid") ||
    normalized.includes("banned") ||
    normalized.includes("failed")
  ) {
    return "error";
  }
  if (
    normalized.includes("inactive") ||
    normalized.includes("disabled") ||
    normalized.includes("quota") ||
    normalized.includes("exhausted") ||
    normalized.includes("limit") ||
    normalized.includes("retry")
  ) {
    return "warning";
  }
  return "healthy";
}

function isDisabledStatus(status: string): boolean {
  const normalized = normalizeForSearch(status);
  return normalized.includes("disabled") || normalized.includes("inactive");
}

function formatDate(raw?: string): string {
  if (!raw) {
    return "-";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return date.toLocaleString();
}

const platforms = ref<PlatformConfig[]>(loadPlatforms());
const themeMode = ref<"light" | "dark">(loadThemeMode());
const autoRefreshSeconds = ref<number>(loadAutoRefreshSeconds());

const currentView = ref<ViewKey>("dashboard");
const accountTab = ref<PlatformKind>("sub2api");
const expandedMenuKeys = ref<string[]>(["accounts"]);

const loading = ref(false);
const refreshing = ref(false);
const actionLoading = ref(false);
const rowLoadingMap = ref<Record<string, boolean>>({});
const viewportHeight = ref(window.innerHeight);

const testLoading = ref<Record<PlatformKind, boolean>>({
  cliproxyapi: false,
  sub2api: false
});
const checkMessages = ref<Record<PlatformKind, string>>({
  cliproxyapi: "",
  sub2api: ""
});

const accounts = ref<UnifiedAccount[]>([]);
const usageTrend = ref<PlatformUsageTrend>({
  labels: [],
  sub2apiValues: [],
  cpaValues: []
});
const errors = ref<string[]>([]);
const accountKeyword = ref("");
const selectedRowKeys = ref<DataTableRowKey[]>([]);

const showDetailModal = ref(false);
const detailTarget = ref<UnifiedAccount | null>(null);
const detailData = ref<AccountDetailResult | null>(null);
const detailLoading = ref(false);
const detailError = ref("");
const detailAutoRefresh = ref(true);
const detailRefreshSeconds = ref(30);

const showEditModal = ref(false);
const editSaving = ref(false);
const editTarget = ref<UnifiedAccount | null>(null);
const editName = ref("");
const editNote = ref("");
const editPriorityText = ref("");

const showBatchEditModal = ref(false);
const batchSaving = ref(false);
const batchApplyNote = ref(true);
const batchApplyPriority = ref(false);
const batchNote = ref("");
const batchPriorityText = ref("");

const isDark = computed(() => themeMode.value === "dark");
const themeOverrides = {
  common: {
    primaryColor: "#0f766e",
    primaryColorHover: "#0d9488",
    primaryColorPressed: "#115e59"
  }
};
const accountsTableMaxHeight = computed(() =>
  Math.max(320, viewportHeight.value - 285)
);

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

const selectedMenuKey = computed(() => {
  if (currentView.value === "accounts") {
    return accountTab.value === "sub2api" ? "accounts-sub2api" : "accounts-cpa";
  }
  return currentView.value;
});

const pageTitle = computed(() => {
  if (currentView.value === "dashboard") {
    return "仪表盘";
  }
  if (currentView.value === "accounts") {
    return "账号管理";
  }
  if (currentView.value === "config") {
    return "配置";
  }
  return "关于";
});

const pageSubtitle = computed(() => {
  if (currentView.value === "dashboard") {
    return "查看两个平台整体状态与数量概览";
  }
  if (currentView.value === "accounts") {
    return "通过左侧菜单在 sub2api 与 cpa 账号之间切换";
  }
  if (currentView.value === "config") {
    return "管理平台地址、API Key 与启用状态";
  }
  return "统一管理平台版本与能力说明";
});

const dashboardTotal = computed(() => accounts.value.length);
const dashboardHealthy = computed(
  () => accounts.value.filter((item) => classifyStatus(item.status) === "healthy").length
);
const dashboardWarning = computed(
  () => accounts.value.filter((item) => classifyStatus(item.status) === "warning").length
);
const dashboardError = computed(
  () => accounts.value.filter((item) => classifyStatus(item.status) === "error").length
);

const platformQuotaSummaries = computed(() => [
  buildPlatformQuotaSummary(accounts.value, "sub2api"),
  buildPlatformQuotaSummary(accounts.value, "cliproxyapi")
]);

const dashboardTransferredTokens = computed(() => {
  const values = platformQuotaSummaries.value
    .map((item) => item.totalTransferredTokens)
    .filter((value): value is number => typeof value === "number");
  if (!values.length) {
    return undefined;
  }
  return values.reduce((sum, value) => sum + value, 0);
});

const accountsForCurrentTab = computed(() => {
  const keyword = normalizeForSearch(accountKeyword.value);
  return accounts.value.filter((item) => {
    if (item.platform !== accountTab.value) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    const bag = [
      item.name,
      item.accountId,
      item.type,
      item.status,
      item.email ?? "",
      item.note ?? ""
    ]
      .join(" ")
      .toLowerCase();
    return bag.includes(keyword);
  });
});

const selectedAccounts = computed(() => {
  const keySet = new Set(selectedRowKeys.value.map((key) => String(key)));
  return accountsForCurrentTab.value.filter((item) => keySet.has(item.uid));
});

const currentTableTitle = computed(() =>
  accountTab.value === "sub2api" ? "sub2api 账号列表" : "cpa 账号列表"
);

const editSupportsName = computed(() => editTarget.value?.platform === "sub2api");

const detailProfileText = computed(() =>
  JSON.stringify(
    detailData.value?.profile ?? detailData.value?.account.raw ?? {},
    null,
    2
  )
);
const detailStatsText = computed(() =>
  JSON.stringify(detailData.value?.stats ?? {}, null, 2)
);
const detailModelsText = computed(() =>
  JSON.stringify(detailData.value?.models ?? [], null, 2)
);
const detailRefreshedAtText = computed(() =>
  formatDate(detailData.value?.refreshedAt)
);

let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let detailRefreshTimer: ReturnType<typeof setInterval> | null = null;

function applyThemeToDocument(): void {
  document.documentElement.setAttribute("data-theme", themeMode.value);
}

function setFeedback(type: FeedbackType, message: string): void {
  notify(type, message);
}

function persistPlatforms(): void {
  localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(platforms.value));
}

function saveSettings(options?: { silent?: boolean }): void {
  for (const platform of platforms.value) {
    platform.baseUrl = sanitizeBaseUrl(platform.baseUrl);
    platform.apiKey = platform.apiKey.trim();
  }
  persistPlatforms();
  if (!options?.silent) {
    setFeedback("success", "配置已保存。");
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

function getPlatformConfig(platformId: PlatformKind): PlatformConfig {
  const platform = platforms.value.find((item) => item.id === platformId);
  if (!platform) {
    throw new Error(`未找到平台配置：${platformId}`);
  }
  return platform;
}

function setRowLoading(uid: string, value: boolean): void {
  rowLoadingMap.value = {
    ...rowLoadingMap.value,
    [uid]: value
  };
}

function clearSelection(): void {
  selectedRowKeys.value = [];
}

function handleMenuSelect(key: string): void {
  if (key === "dashboard") {
    currentView.value = "dashboard";
    return;
  }
  if (key === "config") {
    currentView.value = "config";
    return;
  }
  if (key === "about") {
    currentView.value = "about";
    return;
  }
  if (key === "accounts-sub2api") {
    currentView.value = "accounts";
    accountTab.value = "sub2api";
    return;
  }
  if (key === "accounts-cpa") {
    currentView.value = "accounts";
    accountTab.value = "cliproxyapi";
    return;
  }
  if (key === "accounts") {
    currentView.value = "accounts";
    const hasSub2Api = accounts.value.some((item) => item.platform === "sub2api");
    const hasCpa = accounts.value.some((item) => item.platform === "cliproxyapi");
    if (!hasSub2Api && hasCpa) {
      accountTab.value = "cliproxyapi";
    } else if (hasSub2Api && !hasCpa) {
      accountTab.value = "sub2api";
    }
  }
}

function handleExpandedKeys(keys: string[]): void {
  expandedMenuKeys.value = keys;
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
    const [accountResult, trendResult] = await Promise.all([
      fetchUnifiedAccounts(platforms.value),
      fetchPlatformUsageTrend(platforms.value, 14)
    ]);
    accounts.value = accountResult.accounts;
    usageTrend.value = trendResult.trend;
    errors.value = [...accountResult.errors, ...trendResult.errors];
    if (currentView.value === "accounts") {
      const hasCurrent = accountResult.accounts.some(
        (item) => item.platform === accountTab.value
      );
      if (!hasCurrent) {
        const fallbackTab: PlatformKind =
          accountTab.value === "sub2api" ? "cliproxyapi" : "sub2api";
        const hasFallback = accountResult.accounts.some(
          (item) => item.platform === fallbackTab
        );
        if (hasFallback) {
          accountTab.value = fallbackTab;
          clearSelection();
          setFeedback("warning", `当前平台暂无账号，已自动切换到 ${fallbackTab}。`);
        }
      }
    }
    if (errors.value.length && !options?.silent) {
      setFeedback(
        "warning",
        errors.value.slice(0, 2).join("；")
      );
    }

    const validKeys = new Set(accountResult.accounts.map((item) => item.uid));
    selectedRowKeys.value = selectedRowKeys.value.filter((key) =>
      validKeys.has(String(key))
    );

    if (detailTarget.value) {
      const refreshed = accountResult.accounts.find(
        (item) => item.uid === detailTarget.value?.uid
      );
      if (refreshed) {
        detailTarget.value = refreshed;
      }
    }
  } catch (error) {
    const message = parseErrorMessage(error);
    errors.value = [message];
    if (!options?.silent) {
      setFeedback("error", message);
    }
  } finally {
    refreshing.value = false;
    loading.value = false;
  }
}

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

function resetDetailRefreshTimer(): void {
  if (detailRefreshTimer) {
    clearInterval(detailRefreshTimer);
    detailRefreshTimer = null;
  }
  if (
    !showDetailModal.value ||
    !detailAutoRefresh.value ||
    detailRefreshSeconds.value <= 0
  ) {
    return;
  }
  detailRefreshTimer = setInterval(() => {
    void loadAccountDetail(true);
  }, detailRefreshSeconds.value * 1000);
}

function handleWindowResize(): void {
  viewportHeight.value = window.innerHeight;
}

function toggleTheme(): void {
  themeMode.value = themeMode.value === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, themeMode.value);
  applyThemeToDocument();
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

async function handleToggleAccount(account: UnifiedAccount): Promise<void> {
  const platform = getPlatformConfig(account.platform);
  const shouldEnable = isDisabledStatus(account.status);
  setRowLoading(account.uid, true);
  try {
    await setAccountEnabled(platform, account, shouldEnable);
    setFeedback(
      "success",
      `${account.name}：${shouldEnable ? "启用" : "停用"}成功。`
    );
    await refreshAccounts({ silent: true });
    if (detailTarget.value?.uid === account.uid) {
      await loadAccountDetail(true);
    }
  } catch (error) {
    setFeedback("error", `${account.name}：${parseErrorMessage(error)}`);
  } finally {
    setRowLoading(account.uid, false);
  }
}

function openEditForAccount(account: UnifiedAccount): void {
  editTarget.value = account;
  editName.value = account.name;
  editNote.value = account.note ?? "";
  editPriorityText.value =
    typeof account.priority === "number" ? String(account.priority) : "";
  showEditModal.value = true;
}

async function saveEdit(): Promise<void> {
  if (!editTarget.value) {
    return;
  }
  const target = editTarget.value;
  const platform = getPlatformConfig(target.platform);
  const payload: Record<string, unknown> = {};

  if (target.platform === "sub2api") {
    const nextName = editName.value.trim();
    if (nextName && nextName !== target.name) {
      payload.name = nextName;
    }
  }

  const normalizedNote = editNote.value.trim();
  if (normalizedNote !== (target.note ?? "")) {
    payload.note = normalizedNote;
  }

  const normalizedPriorityText = editPriorityText.value.trim();
  if (normalizedPriorityText) {
    const parsedPriority = Number.parseInt(normalizedPriorityText, 10);
    if (!Number.isFinite(parsedPriority) || parsedPriority < 0) {
      setFeedback("error", "优先级必须为非负整数。");
      return;
    }
    if (parsedPriority !== target.priority) {
      payload.priority = parsedPriority;
    }
  } else if (
    target.platform === "cliproxyapi" &&
    typeof target.priority === "number"
  ) {
    payload.priority = 0;
  }

  if (!Object.keys(payload).length) {
    setFeedback("warning", "没有可提交的变更。");
    return;
  }

  editSaving.value = true;
  try {
    await updateAccountEditableFields(
      platform,
      target,
      payload as { name?: string; note?: string; priority?: number }
    );
    showEditModal.value = false;
    setFeedback("success", `${target.name}：字段更新成功。`);
    await refreshAccounts({ silent: true });
    if (detailTarget.value?.uid === target.uid) {
      await loadAccountDetail(true);
    }
  } catch (error) {
    setFeedback("error", parseErrorMessage(error));
  } finally {
    editSaving.value = false;
  }
}

async function runBatchEnable(enabled: boolean): Promise<void> {
  if (!selectedAccounts.value.length) {
    setFeedback("warning", "请至少选择一个账号。");
    return;
  }
  actionLoading.value = true;
  const grouped = new Map<PlatformKind, UnifiedAccount[]>();
  for (const account of selectedAccounts.value) {
    if (!grouped.has(account.platform)) {
      grouped.set(account.platform, []);
    }
    grouped.get(account.platform)?.push(account);
  }

  try {
    for (const [platformKind, groupAccounts] of grouped.entries()) {
      await batchSetAccountsEnabled(
        getPlatformConfig(platformKind),
        groupAccounts,
        enabled
      );
    }
    setFeedback(
      "success",
      `批量${enabled ? "启用" : "停用"}完成，共 ${selectedAccounts.value.length} 个账号。`
    );
    await refreshAccounts({ silent: true });
  } catch (error) {
    setFeedback("error", parseErrorMessage(error));
  } finally {
    actionLoading.value = false;
  }
}

function openBatchEditModal(): void {
  if (!selectedAccounts.value.length) {
    setFeedback("warning", "请至少选择一个账号。");
    return;
  }
  batchApplyNote.value = true;
  batchApplyPriority.value = false;
  batchNote.value = "";
  batchPriorityText.value = "";
  showBatchEditModal.value = true;
}

async function saveBatchEdit(): Promise<void> {
  if (!selectedAccounts.value.length) {
    return;
  }
  if (!batchApplyNote.value && !batchApplyPriority.value) {
    setFeedback("warning", "请至少选择一个要批量修改的字段。");
    return;
  }

  const grouped = new Map<PlatformKind, UnifiedAccount[]>();
  for (const account of selectedAccounts.value) {
    if (!grouped.has(account.platform)) {
      grouped.set(account.platform, []);
    }
    grouped.get(account.platform)?.push(account);
  }

  const priorityText = batchPriorityText.value.trim();
  let priorityValue: number | undefined;
  if (batchApplyPriority.value) {
    const parsed = Number.parseInt(priorityText, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setFeedback("error", "批量优先级必须为非负整数。");
      return;
    }
    priorityValue = parsed;
  }

  batchSaving.value = true;
  let noteSkippedForSub2Api = false;
  try {
    for (const [platformKind, groupAccounts] of grouped.entries()) {
      const payload: { note?: string; priority?: number } = {};
      if (batchApplyPriority.value && typeof priorityValue === "number") {
        payload.priority = priorityValue;
      }
      if (batchApplyNote.value) {
        if (platformKind === "cliproxyapi") {
          payload.note = batchNote.value.trim();
        } else {
          noteSkippedForSub2Api = true;
        }
      }
      if (!Object.keys(payload).length) {
        continue;
      }
      await batchUpdateAccountFields(
        getPlatformConfig(platformKind),
        groupAccounts,
        payload
      );
    }

    showBatchEditModal.value = false;
    await refreshAccounts({ silent: true });
    if (noteSkippedForSub2Api) {
      setFeedback(
        "warning",
        "批量修改完成：sub2api 批量接口不支持备注，已自动跳过备注字段。"
      );
    } else {
      setFeedback("success", "批量字段修改成功。");
    }
  } catch (error) {
    setFeedback("error", parseErrorMessage(error));
  } finally {
    batchSaving.value = false;
  }
}

async function openAccountDetail(account: UnifiedAccount): Promise<void> {
  detailTarget.value = account;
  showDetailModal.value = true;
  await loadAccountDetail(false);
}

async function loadAccountDetail(silent: boolean): Promise<void> {
  if (!detailTarget.value) {
    return;
  }
  const current =
    accounts.value.find((item) => item.uid === detailTarget.value?.uid) ??
    detailTarget.value;
  detailTarget.value = current;
  if (!silent) {
    detailLoading.value = true;
  }
  detailError.value = "";
  try {
    detailData.value = await fetchAccountDetail(
      getPlatformConfig(current.platform),
      current
    );
  } catch (error) {
    detailError.value = parseErrorMessage(error);
  } finally {
    detailLoading.value = false;
  }
}

watch(autoRefreshSeconds, (value) => {
  localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(value));
  resetAutoRefreshTimer();
});

watch([showDetailModal, detailAutoRefresh, detailRefreshSeconds], () => {
  resetDetailRefreshTimer();
});

watch(accountTab, () => {
  clearSelection();
  accountKeyword.value = "";
});

watch(themeMode, () => {
  applyThemeToDocument();
});

onMounted(() => {
  applyThemeToDocument();
  handleWindowResize();
  window.addEventListener("resize", handleWindowResize);
  void refreshAccounts();
  resetAutoRefreshTimer();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", handleWindowResize);
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  if (detailRefreshTimer) {
    clearInterval(detailRefreshTimer);
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
    <NLayout has-sider class="app-shell">
      <SidebarNav
        :value="selectedMenuKey"
        :expanded-keys="expandedMenuKeys"
        :options="menuOptions"
        @update:value="handleMenuSelect"
        @update:expanded-keys="handleExpandedKeys"
      />

      <NLayout :native-scrollbar="false">
        <NLayoutHeader class="page-header">
          <div class="page-header__left">
            <h2>{{ pageTitle }}</h2>
            <p>{{ pageSubtitle }}</p>
          </div>
          <NSpace>
            <NSelect
              v-if="currentView === 'dashboard' || currentView === 'accounts'"
              :value="autoRefreshSeconds"
              :options="autoRefreshOptions"
              style="width: 170px"
              @update:value="(value) => (autoRefreshSeconds = value)"
            />
            <NButton
              v-if="currentView === 'dashboard' || currentView === 'accounts'"
              type="primary"
              :loading="loading"
              @click="refreshAccounts()"
            >
              刷新数据
            </NButton>
            <NButton tertiary @click="toggleTheme">
              {{ isDark ? "切换浅色" : "切换深色" }}
            </NButton>
          </NSpace>
        </NLayoutHeader>

        <NLayoutContent class="content" :native-scrollbar="false">
          <template v-if="currentView === 'dashboard'">
            <div class="dashboard-view">
              <AccountStatsGrid
                :total="dashboardTotal"
                :healthy="dashboardHealthy"
                :warning="dashboardWarning"
                :error="dashboardError"
                :total-transferred-tokens="dashboardTransferredTokens"
              />
              <PlatformQuotaSummaryGrid :summaries="platformQuotaSummaries" />
              <PlatformTrendChart
                :labels="usageTrend.labels"
                :sub2api-values="usageTrend.sub2apiValues"
                :cpa-values="usageTrend.cpaValues"
              />
            </div>
          </template>

          <template v-else-if="currentView === 'accounts'">
            <div class="accounts-view">
              <AccountTable
                class="panel-card"
                :title="currentTableTitle"
                :accounts="accountsForCurrentTab"
                :loading="loading"
                :table-max-height="accountsTableMaxHeight"
                :keyword="accountKeyword"
                :selected-row-keys="selectedRowKeys"
                :selected-count="selectedAccounts.length"
                :row-loading-map="rowLoadingMap"
                :action-loading="actionLoading"
                @update:keyword="(value) => (accountKeyword = value)"
                @update:selected-row-keys="(keys) => (selectedRowKeys = keys)"
                @open-detail="openAccountDetail"
                @open-edit="openEditForAccount"
                @toggle-account="handleToggleAccount"
                @batch-enable="runBatchEnable"
                @open-batch-edit="openBatchEditModal"
                @clear-selection="clearSelection"
              />
            </div>
          </template>

          <template v-else-if="currentView === 'config'">
            <PlatformConfigPanel
              :platforms="platforms"
              :test-loading="testLoading"
              :check-messages="checkMessages"
              @update-platform-field="updatePlatformField"
              @save-settings="saveSettings"
              @test-platform="testConnection"
            />
          </template>

          <template v-else>
            <NCard title="关于" size="small" class="panel-card">
              <p>这是一个用于统一管理 sub2api 与 cpa 账号的前端管理平台。</p>
              <p>当前版本支持：</p>
              <p>1. 仪表盘状态概览</p>
              <p>2. 分平台账号管理（由左侧菜单切换）</p>
              <p>3. 账号详情、启停、单条编辑、批量操作</p>
              <p>4. 平台连接配置与连通性测试</p>
            </NCard>
          </template>
        </NLayoutContent>
      </NLayout>
    </NLayout>

    <AccountDetailModal
      :show="showDetailModal"
      :target="detailTarget"
      :loading="detailLoading"
      :error="detailError"
      :profile-text="detailProfileText"
      :stats-text="detailStatsText"
      :models-text="detailModelsText"
      :refreshed-at-text="detailRefreshedAtText"
      :auto-refresh="detailAutoRefresh"
      :refresh-seconds="detailRefreshSeconds"
      :refresh-options="detailRefreshOptions"
      @update:show="(value) => (showDetailModal = value)"
      @refresh="loadAccountDetail(false)"
      @update:auto-refresh="(value) => (detailAutoRefresh = value)"
      @update:refresh-seconds="(value) => (detailRefreshSeconds = value)"
    />

    <EditAccountModal
      :show="showEditModal"
      :supports-name="editSupportsName"
      :name="editName"
      :note="editNote"
      :priority-text="editPriorityText"
      :saving="editSaving"
      @update:show="(value) => (showEditModal = value)"
      @update:name="(value) => (editName = value)"
      @update:note="(value) => (editNote = value)"
      @update:priority-text="(value) => (editPriorityText = value)"
      @save="saveEdit"
    />

    <BatchEditModal
      :show="showBatchEditModal"
      :saving="batchSaving"
      :selected-count="selectedAccounts.length"
      :apply-note="batchApplyNote"
      :apply-priority="batchApplyPriority"
      :note="batchNote"
      :priority-text="batchPriorityText"
      @update:show="(value) => (showBatchEditModal = value)"
      @update:apply-note="(value) => (batchApplyNote = value)"
      @update:apply-priority="(value) => (batchApplyPriority = value)"
      @update:note="(value) => (batchNote = value)"
      @update:priority-text="(value) => (batchPriorityText = value)"
      @save="saveBatchEdit"
    />
  </NConfigProvider>
</template>





