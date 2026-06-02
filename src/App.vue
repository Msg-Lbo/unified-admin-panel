<script setup lang="ts">
import { SettingsOutline } from "@vicons/ionicons5";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createDiscreteApi,
  darkTheme,
  dateZhCN,
  NButton,
  NConfigProvider,
  NDropdown,
  NIcon,
  NInput,
  NScrollbar,
  NSelect,
  NSwitch,
  NSpace,
  zhCN
} from "naive-ui";
import AccountJsonModal from "./components/AccountJsonModal.vue";
import AccountManageModals from "./components/AccountManageModals.vue";
import AccountQuotaCard from "./components/AccountQuotaCard.vue";
import FloatingConfigModal from "./components/FloatingConfigModal.vue";
import {
  batchRenameAccountsToEmail,
  batchSetAccountsEnabled,
  batchUpdateAccountFields,
  fetchAccountsForPlatform,
  fetchUnifiedAccounts,
  renameAccountName,
  resolveAccountEmail,
  sanitizeBaseUrl,
  setAccountEnabled
} from "./services/platformClients";
import type {
  PlatformConfig,
  PlatformKind,
  StoredPlatformPrefs,
  UnifiedAccount
} from "./types/platform";
import type {
  PlatformSortSettings,
  SortDirection,
  SortField
} from "./types/viewSettings";
import {
  buildAccountQuotaMetrics,
  isUnknownPlanAccount,
  type QuotaCardMetrics
} from "./utils/quotaCard";

const PLATFORM_STORAGE_KEY = "unified-admin-panel.platforms";
const SORT_STORAGE_KEY = "unified-admin-panel.sort-settings";
const THEME_STORAGE_KEY = "unified-admin-panel.theme";
const AUTO_REFRESH_STORAGE_KEY = "unified-admin-panel.auto-refresh-seconds";
const SPLIT_RATIO_STORAGE_KEY = "unified-admin-panel.split-ratio";
const AUTH_SESSION_KEY = "unified-admin-panel.auth-session";
const LOGIN_PASSWORD_ENV = String(import.meta.env.VITE_LOGIN_PASSWORD ?? "").trim();
const LOGIN_TOKEN_ENV = String(import.meta.env.VITE_LOGIN_TOKEN ?? "").trim();

type FeedbackType = "success" | "warning" | "error";
type AccountStateKind = "normal" | "exhausted" | "disabled" | "error" | "banned";
const PLATFORM_KINDS: PlatformKind[] = ["sub2api", "cliproxyapi"];
const AUTO_REFRESH_ALLOWED_SECONDS = [0, 15, 30, 60] as const;
const DEFAULT_AUTO_REFRESH_SECONDS = 30;

interface RuntimePlatformConfig {
  id: PlatformKind;
  baseUrl?: string;
  apiKey?: string;
}

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

function buildStoredPlatformPrefs(): StoredPlatformPrefs[] {
  return platforms.value.map((platform) => ({
    id: platform.id,
    enabled: platform.enabled
  }));
}

function readStoredEnabledMap(): Partial<Record<PlatformKind, boolean>> {
  try {
    const raw = localStorage.getItem(PLATFORM_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return {};
    }
    const enabledMap: Partial<Record<PlatformKind, boolean>> = {};
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      const id = record.id;
      if (id !== "cliproxyapi" && id !== "sub2api") {
        continue;
      }
      if (typeof record.enabled === "boolean") {
        enabledMap[id] = record.enabled;
      }
    }
    return enabledMap;
  } catch {
    return {};
  }
}

function buildPlatformsFromDefaults(): PlatformConfig[] {
  const enabledMap = readStoredEnabledMap();
  return cloneDefaultPlatforms().map((platform) => ({
    ...platform,
    enabled: enabledMap[platform.id] ?? platform.enabled
  }));
}

function isRuntimePlatformConfigArray(value: unknown): value is RuntimePlatformConfig[] {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const candidate = item as RuntimePlatformConfig;
    return (
      (candidate.id === "cliproxyapi" || candidate.id === "sub2api") &&
      (typeof candidate.baseUrl === "undefined" || typeof candidate.baseUrl === "string") &&
      (typeof candidate.apiKey === "undefined" || typeof candidate.apiKey === "string")
    );
  });
}

function applyRuntimePlatformDefaults(runtimePlatforms: RuntimePlatformConfig[]): void {
  for (const runtimePlatform of runtimePlatforms) {
    const target = defaultPlatforms.find((item) => item.id === runtimePlatform.id);
    if (!target) {
      continue;
    }
    target.baseUrl = sanitizeBaseUrl(runtimePlatform.baseUrl ?? "");
    target.apiKey = runtimePlatform.apiKey?.trim() ?? "";
  }
  platforms.value = buildPlatformsFromDefaults();
}

function cloneDefaultSortSettings(): PlatformSortSettings {
  return {
    sub2api: { ...defaultSortSettings.sub2api },
    cliproxyapi: { ...defaultSortSettings.cliproxyapi }
  };
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
  return buildPlatformsFromDefaults();
}

function loadSortSettings(): PlatformSortSettings {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY);
    if (!raw) {
      return cloneDefaultSortSettings();
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const defaults = cloneDefaultSortSettings();
    for (const platformId of PLATFORM_KINDS) {
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
    return DEFAULT_AUTO_REFRESH_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (
    !Number.isFinite(parsed) ||
    !AUTO_REFRESH_ALLOWED_SECONDS.includes(parsed as (typeof AUTO_REFRESH_ALLOWED_SECONDS)[number])
  ) {
    return DEFAULT_AUTO_REFRESH_SECONDS;
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

function loadAuthSession(): boolean {
  try {
    return sessionStorage.getItem(AUTH_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function persistAuthSession(authorized: boolean): void {
  try {
    if (authorized) {
      sessionStorage.setItem(AUTH_SESSION_KEY, "1");
      return;
    }
    sessionStorage.removeItem(AUTH_SESSION_KEY);
  } catch {
    // no-op: storage may be unavailable in private contexts
  }
}

const platforms = ref<PlatformConfig[]>(loadPlatforms());
const sortSettings = ref<PlatformSortSettings>(loadSortSettings());
const themeMode = ref<"light" | "dark">(loadThemeMode());
const autoRefreshSeconds = ref<number>(loadAutoRefreshSeconds());
const splitRatio = ref<number>(loadSplitRatio());
const currentYear = new Date().getFullYear();
const isAuthenticated = ref(loadAuthSession());
const loginPassword = ref("");
const loginToken = ref("");
const loginError = ref("");

const loading = ref(false);
const refreshing = ref(false);
const showConfigModal = ref(false);
const selectionMode = ref(false);
const selectedUidSet = ref<Set<string>>(new Set());
const showBatchEditModal = ref(false);
const showRenameModal = ref(false);
const renameMode = ref<"single" | "batch">("single");
const renameTargetAccounts = ref<UnifiedAccount[]>([]);
const manageSubmitting = ref(false);
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
const leftGridRef = ref<HTMLElement | null>(null);
const rightGridRef = ref<HTMLElement | null>(null);
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const contextMenuAccount = ref<UnifiedAccount | null>(null);
const showJsonModal = ref(false);
const jsonViewAccount = ref<UnifiedAccount | null>(null);
const singleRefreshLoadingUid = ref<string | null>(null);
let splitFlipFrame: number | null = null;
const flipAnimationMap = new WeakMap<HTMLElement, Animation>();
let dragMoveFrame: number | null = null;
let latestDragClientX: number | null = null;

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
  localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(buildStoredPlatformPrefs()));
}

function persistSortSettings(): void {
  localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sortSettings.value));
}

function saveSettings(options?: { silent?: boolean }): void {
  persistPlatforms();
  persistSortSettings();
  if (!options?.silent) {
    notify("success", "配置已保存。");
  }
}

async function loadRuntimeConfig(): Promise<void> {
  try {
    const response = await fetch("/api/config", {
      headers: { accept: "application/json" }
    });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as Record<string, unknown>;
    if (!isRuntimePlatformConfigArray(payload.platforms)) {
      return;
    }
    applyRuntimePlatformDefaults(payload.platforms);
  } catch {
    // 运行时配置不可用时地址与 Key 保持为空，需检查 Cloudflare 环境变量。
  }
}

function updatePlatformEnabled(payload: {
  platformId: PlatformKind;
  enabled: boolean;
}): void {
  const target = platforms.value.find((item) => item.id === payload.platformId);
  if (!target) {
    return;
  }
  target.enabled = payload.enabled;
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
  return [...list].sort((a, b) => {
    const aUnknown = isUnknownPlanAccount(a);
    const bUnknown = isUnknownPlanAccount(b);
    if (aUnknown !== bUnknown) {
      return aUnknown ? 1 : -1;
    }
    return (
      a.platformName.localeCompare(b.platformName) ||
      a.name.localeCompare(b.name)
    );
  });
}

function groupAccountsByPlatform(
  list: UnifiedAccount[]
): Map<PlatformKind, UnifiedAccount[]> {
  const grouped = new Map<PlatformKind, UnifiedAccount[]>();
  for (const account of list) {
    if (!grouped.has(account.platform)) {
      grouped.set(account.platform, []);
    }
    grouped.get(account.platform)?.push(account);
  }
  return grouped;
}

function mergeAccountsWithFallback(
  nextAccounts: UnifiedAccount[],
  errorMessages: string[]
): UnifiedAccount[] {
  const erroredPlatforms = detectErrorPlatforms(errorMessages);
  if (!erroredPlatforms.size) {
    return nextAccounts;
  }

  const previousByPlatform = groupAccountsByPlatform(accounts.value);
  const nextByPlatform = groupAccountsByPlatform(nextAccounts);

  const merged: UnifiedAccount[] = [];
  for (const platformId of PLATFORM_KINDS) {
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

async function refreshAccounts(options?: {
  silent?: boolean;
  forceRefresh?: boolean;
}): Promise<void> {
  if (refreshing.value) {
    return;
  }
  saveSettings({ silent: true });
  refreshing.value = true;
  if (!options?.silent) {
    loading.value = true;
  }
  try {
    const result = await fetchUnifiedAccounts(platforms.value, {
      forceRefresh: options?.forceRefresh ?? true
    });
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
  const result = await fetchAccountsForPlatform(platform, { forceRefresh: true });
  checkMessages.value[platformId] = result.error
    ? result.error
    : `已拉取 ${result.accounts.length} 条账号记录。`;
  testLoading.value[platformId] = false;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function pickFirstText(values: unknown[]): string | undefined {
  for (const item of values) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = item.trim();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function toTokenCandidate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length < 16) {
    return undefined;
  }
  return normalized;
}

function extractTokenFromRecord(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) {
    return undefined;
  }

  const direct = pickFirstText([
    record.access_token,
    record.accessToken,
    record.oauth_access_token,
    record.oauthAccessToken,
    record.bearer_token,
    record.bearerToken,
    record.session_token,
    record.sessionToken,
    record.token
  ]);
  const directToken = toTokenCandidate(direct);
  if (directToken) {
    return directToken;
  }

  const nestedKeys = ["oauth", "auth", "tokens", "credentials"];
  for (const key of nestedKeys) {
    const nested = toRecord(record[key]);
    const nestedToken = extractTokenFromRecord(nested);
    if (nestedToken) {
      return nestedToken;
    }
  }

  return undefined;
}

function resolveAccessToken(account: UnifiedAccount): string | undefined {
  const raw = toRecord(account.raw);
  const credentials = toRecord(raw?.credentials);
  const metadata = toRecord(raw?.metadata);
  const attributes = toRecord(raw?.attributes);

  const resolved =
    extractTokenFromRecord(credentials) ??
    extractTokenFromRecord(metadata) ??
    extractTokenFromRecord(attributes) ??
    extractTokenFromRecord(raw);
  if (resolved) {
    return resolved;
  }

  // cpa 场景下某些实现只回传 id_token，作为兜底提供复制能力。
  if (account.platform === "cliproxyapi") {
    return toTokenCandidate(
      pickFirstText([
        credentials?.id_token,
        metadata?.id_token,
        attributes?.id_token,
        raw?.id_token
      ])
    );
  }

  return undefined;
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

async function copyWithFeedback(payload: {
  value: string;
  successMessage: string;
  emptyMessage: string;
}): Promise<void> {
  const normalized = payload.value.trim();
  if (!normalized) {
    notify("warning", payload.emptyMessage);
    return;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(normalized);
    } else {
      const ok = copyTextBySelection(normalized);
      if (!ok) {
        throw new Error("copy-failed");
      }
    }
    notify("success", payload.successMessage);
  } catch {
    notify("error", "复制失败，请检查浏览器权限。");
  }
}

async function handleCopyEmail(email: string): Promise<void> {
  await copyWithFeedback({
    value: email,
    successMessage: `已复制邮箱：${email.trim()}`,
    emptyMessage: "该账号没有可复制的邮箱。"
  });
}

async function handleCopyAccessToken(account: UnifiedAccount): Promise<void> {
  const token = resolveAccessToken(account);
  await copyWithFeedback({
    value: token ?? "",
    successMessage: "已复制 accessToken。",
    emptyMessage: "该账号没有可复制的 accessToken。"
  });
}

function closeContextMenu(): void {
  contextMenuVisible.value = false;
  contextMenuAccount.value = null;
}

function openContextMenu(payload: {
  account: UnifiedAccount;
  x: number;
  y: number;
}): void {
  contextMenuAccount.value = payload.account;
  contextMenuX.value = payload.x;
  contextMenuY.value = payload.y;
  contextMenuVisible.value = true;
}

async function refreshSingleAccount(account: UnifiedAccount): Promise<void> {
  if (singleRefreshLoadingUid.value === account.uid) {
    return;
  }

  const platform = getPlatformConfig(account.platform);
  saveSettings({ silent: true });
  singleRefreshLoadingUid.value = account.uid;
  try {
    const result = await fetchAccountsForPlatform(platform, { forceRefresh: true });
    if (result.error) {
      throw new Error(result.error);
    }

    const refreshed =
      result.accounts.find((item) => item.uid === account.uid) ??
      result.accounts.find((item) => item.manageKey === account.manageKey) ??
      result.accounts.find((item) => item.accountId === account.accountId);

    if (!refreshed) {
      notify("warning", "未找到该账号的最新数据。");
      return;
    }

    accounts.value = accounts.value.map((item) =>
      item.uid === account.uid ? refreshed : item
    );
    notify("success", `已刷新 ${account.email ?? account.name}。`);
  } catch (error) {
    notify("error", parseErrorMessage(error));
  } finally {
    singleRefreshLoadingUid.value = null;
  }
}

function toggleTheme(): void {
  themeMode.value = themeMode.value === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, themeMode.value);
  applyThemeToDocument(themeMode.value);
}

function isLoginCredentialValid(password: string, token: string): boolean {
  const normalizedPassword = password.trim();
  const normalizedToken = token.trim();
  const requiresExactMatch = Boolean(LOGIN_PASSWORD_ENV || LOGIN_TOKEN_ENV);

  if (requiresExactMatch) {
    const passwordMatched =
      Boolean(LOGIN_PASSWORD_ENV) && normalizedPassword === LOGIN_PASSWORD_ENV;
    const tokenMatched = Boolean(LOGIN_TOKEN_ENV) && normalizedToken === LOGIN_TOKEN_ENV;
    return passwordMatched || tokenMatched;
  }

  return Boolean(normalizedPassword || normalizedToken);
}

function handleLogin(): void {
  if (!isLoginCredentialValid(loginPassword.value, loginToken.value)) {
    loginError.value =
      LOGIN_PASSWORD_ENV || LOGIN_TOKEN_ENV
        ? "密码或 Token 错误，请重试。"
        : "请输入密码或 Token。";
    return;
  }

  loginError.value = "";
  isAuthenticated.value = true;
  persistAuthSession(true);
  notify("success", "登录成功。");
}

function logout(): void {
  closeContextMenu();
  showConfigModal.value = false;
  isAuthenticated.value = false;
  loginPassword.value = "";
  loginToken.value = "";
  loginError.value = "";
  persistAuthSession(false);
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

function resolveAccountState(account: UnifiedAccount): AccountStateKind {
  const normalized = account.status.trim().toLowerCase();
  if (
    normalized.includes("banned") ||
    normalized.includes("deactivated") ||
    normalized.includes("account_deactivated") ||
    normalized.includes("suspended")
  ) {
    return "banned";
  }

  const metrics = getMetrics(account);
  if (metrics.exhausted) {
    return "exhausted";
  }
  const hasClearRemainingQuota =
    (typeof metrics.usedPercent === "number" && metrics.usedPercent < 99.95) ||
    (typeof metrics.remainingPercent === "number" && metrics.remainingPercent > 0.05);

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
    normalized.includes("quota exhausted") ||
    normalized.includes("insufficient quota") ||
    normalized.includes("rate_limited") ||
    normalized.includes("rate_limit") ||
    normalized.includes("rate limit") ||
    normalized.includes("rate-limit") ||
    normalized.includes("ratelimited") ||
    normalized.includes("retry")
  ) {
    if (hasClearRemainingQuota) {
      return "error";
    }
    return "exhausted";
  }
  return "normal";
}

function summarizeAccountStates(list: UnifiedAccount[]): Record<AccountStateKind, number> {
  const summary: Record<AccountStateKind, number> = {
    normal: 0,
    exhausted: 0,
    disabled: 0,
    error: 0,
    banned: 0
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
    return metrics.usedUsdValue ?? metrics.usedValue;
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
    const aUnknown = isUnknownPlanAccount(a);
    const bUnknown = isUnknownPlanAccount(b);
    if (aUnknown !== bUnknown) {
      return aUnknown ? 1 : -1;
    }

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

function isPlatformVisible(platformId: PlatformKind): boolean {
  return platforms.value.find((item) => item.id === platformId)?.enabled ?? true;
}

const sub2apiVisible = computed(() => isPlatformVisible("sub2api"));
const cpaVisible = computed(() => isPlatformVisible("cliproxyapi"));
const visiblePaneCount = computed(() => Number(sub2apiVisible.value) + Number(cpaVisible.value));

const sub2apiAccounts = computed(() => {
  if (!sub2apiVisible.value) {
    return [];
  }
  const list = accounts.value.filter((item) => item.platform === "sub2api");
  return sortPlatformAccounts(list, sortSettings.value.sub2api);
});

const cpaAccounts = computed(() => {
  if (!cpaVisible.value) {
    return [];
  }
  const list = accounts.value.filter((item) => item.platform === "cliproxyapi");
  return sortPlatformAccounts(list, sortSettings.value.cliproxyapi);
});

const selectedAccounts = computed(() =>
  accounts.value.filter((item) => selectedUidSet.value.has(item.uid))
);

const selectedCount = computed(() => selectedUidSet.value.size);

function isAccountSelected(uid: string): boolean {
  return selectedUidSet.value.has(uid);
}

function toggleAccountSelection(uid: string): void {
  const next = new Set(selectedUidSet.value);
  if (next.has(uid)) {
    next.delete(uid);
  } else {
    next.add(uid);
  }
  selectedUidSet.value = next;
}

function clearAccountSelection(): void {
  selectedUidSet.value = new Set();
}

function selectAccountsByPlatform(platformId: PlatformKind): void {
  const list = platformId === "sub2api" ? sub2apiAccounts.value : cpaAccounts.value;
  const next = new Set(selectedUidSet.value);
  for (const account of list) {
    next.add(account.uid);
  }
  selectedUidSet.value = next;
}

function toggleSelectionMode(): void {
  selectionMode.value = !selectionMode.value;
  if (!selectionMode.value) {
    clearAccountSelection();
  }
}

function requireSamePlatformSelection(): PlatformKind | null {
  const selected = selectedAccounts.value;
  if (!selected.length) {
    notify("warning", "请先选择账号。");
    return null;
  }
  const platform = selected[0].platform;
  if (selected.some((item) => item.platform !== platform)) {
    notify("warning", "批量操作仅支持同一平台的账号。");
    return null;
  }
  return platform;
}

function openBatchEditModal(): void {
  const platform = requireSamePlatformSelection();
  if (!platform) {
    return;
  }
  showBatchEditModal.value = true;
}

function openBatchRenameModal(): void {
  const platform = requireSamePlatformSelection();
  if (!platform) {
    return;
  }
  if (platform !== "sub2api") {
    notify("warning", "批量邮箱重命名仅支持 Sub2API 账号。");
    return;
  }
  renameMode.value = "batch";
  renameTargetAccounts.value = [...selectedAccounts.value];
  showRenameModal.value = true;
}

function openSingleRenameModal(account: UnifiedAccount): void {
  renameMode.value = "single";
  renameTargetAccounts.value = [account];
  showRenameModal.value = true;
}

function openSingleEditModal(account: UnifiedAccount): void {
  clearAccountSelection();
  selectedUidSet.value = new Set([account.uid]);
  showBatchEditModal.value = true;
}

async function applyBatchEdit(payload: {
  priority?: number;
  note?: string;
  schedulable?: boolean;
}): Promise<void> {
  const platformId = requireSamePlatformSelection();
  if (!platformId) {
    return;
  }
  const platform = getPlatformConfig(platformId);
  const targets = selectedAccounts.value;
  manageSubmitting.value = true;
  try {
    if (typeof payload.schedulable === "boolean") {
      await batchSetAccountsEnabled(platform, targets, payload.schedulable);
    }
    await batchUpdateAccountFields(platform, targets, payload);
    notify("success", `已更新 ${targets.length} 个账号。`);
    showBatchEditModal.value = false;
    clearAccountSelection();
    await refreshAccounts({ silent: true });
  } catch (error) {
    notify("error", parseErrorMessage(error));
  } finally {
    manageSubmitting.value = false;
  }
}

async function applyRename(payload: { name: string }): Promise<void> {
  const targets = renameTargetAccounts.value;
  if (!targets.length) {
    return;
  }
  const platform = getPlatformConfig(targets[0].platform);
  manageSubmitting.value = true;
  try {
    if (renameMode.value === "batch") {
      const result = await batchRenameAccountsToEmail(platform, targets);
      notify(
        "success",
        `批量重命名完成：成功 ${result.renamed} 个，跳过 ${result.skipped} 个。`
      );
    } else {
      await renameAccountName(platform, targets[0], payload.name);
      notify("success", "账号已重命名。");
    }
    showRenameModal.value = false;
    clearAccountSelection();
    await refreshAccounts({ silent: true });
  } catch (error) {
    notify("error", parseErrorMessage(error));
  } finally {
    manageSubmitting.value = false;
  }
}

async function handleBatchEnable(enabled: boolean): Promise<void> {
  const platformId = requireSamePlatformSelection();
  if (!platformId) {
    return;
  }
  manageSubmitting.value = true;
  try {
    await batchSetAccountsEnabled(
      getPlatformConfig(platformId),
      selectedAccounts.value,
      enabled
    );
    notify("success", enabled ? "已批量启用。" : "已批量停用。");
    clearAccountSelection();
    await refreshAccounts({ silent: true });
  } catch (error) {
    notify("error", parseErrorMessage(error));
  } finally {
    manageSubmitting.value = false;
  }
}

async function handleToggleAccountEnabled(account: UnifiedAccount): Promise<void> {
  const normalized = account.status.trim().toLowerCase();
  const enabled = normalized.includes("inactive") || normalized.includes("disabled")
    ? true
    : false;
  try {
    await setAccountEnabled(getPlatformConfig(account.platform), account, enabled);
    notify("success", enabled ? "账号已启用。" : "账号已停用。");
    await refreshAccounts({ silent: true });
  } catch (error) {
    notify("error", parseErrorMessage(error));
  }
}

const sub2apiStateSummary = computed(() => summarizeAccountStates(sub2apiAccounts.value));
const cpaStateSummary = computed(() => summarizeAccountStates(cpaAccounts.value));
const contextMenuOptions = computed(() => {
  const account = contextMenuAccount.value;
  const hasEmail = Boolean(account && resolveAccountEmail(account));
  const hasAccessToken = Boolean(account && resolveAccessToken(account));
  const refreshingCurrent =
    Boolean(account) && singleRefreshLoadingUid.value === account?.uid;
  const normalizedStatus = account?.status.trim().toLowerCase() ?? "";
  const isDisabled =
    normalizedStatus.includes("inactive") || normalizedStatus.includes("disabled");

  return [
    {
      label: "复制邮箱",
      key: "copy-email",
      disabled: !hasEmail
    },
    {
      label: "复制 accessToken",
      key: "copy-access-token",
      disabled: !hasAccessToken
    },
    {
      label: "查看 JSON",
      key: "view-json"
    },
    {
      type: "divider",
      key: "divider-actions"
    },
    {
      label: "重命名",
      key: "rename-account",
      disabled: account?.platform !== "sub2api"
    },
    {
      label: "编辑账号",
      key: "edit-account"
    },
    {
      label: isDisabled ? "启用账号" : "停用账号",
      key: "toggle-enabled"
    },
    {
      type: "divider",
      key: "divider-refresh"
    },
    {
      label: refreshingCurrent ? "刷新中..." : "刷新该账号",
      key: "refresh-account",
      disabled: refreshingCurrent
    }
  ];
});

async function handleContextMenuSelect(key: string | number): Promise<void> {
  const account = contextMenuAccount.value;
  closeContextMenu();
  if (!account) {
    return;
  }

  if (key === "copy-email") {
    await handleCopyEmail(resolveAccountEmail(account) ?? "");
    return;
  }
  if (key === "copy-access-token") {
    await handleCopyAccessToken(account);
    return;
  }
  if (key === "view-json") {
    jsonViewAccount.value = account;
    showJsonModal.value = true;
    return;
  }
  if (key === "rename-account") {
    openSingleRenameModal(account);
    return;
  }
  if (key === "edit-account") {
    openSingleEditModal(account);
    return;
  }
  if (key === "toggle-enabled") {
    await handleToggleAccountEnabled(account);
    return;
  }
  if (key === "refresh-account") {
    await refreshSingleAccount(account);
  }
}

const leftPaneStyle = computed(() => {
  if (visiblePaneCount.value <= 1) {
    return { flex: "1 1 auto" };
  }
  if (sub2apiVisible.value && !cpaVisible.value) {
    return { flex: "1 1 auto" };
  }
  return { flexBasis: `${splitRatio.value}%` };
});
const rightPaneStyle = computed(() => {
  if (visiblePaneCount.value <= 1) {
    return { flex: "1 1 auto" };
  }
  if (cpaVisible.value && !sub2apiVisible.value) {
    return { flex: "1 1 auto" };
  }
  return { flexBasis: `${100 - splitRatio.value}%` };
});

function captureCardPositions(container: HTMLElement | null): Map<string, DOMRect> {
  const map = new Map<string, DOMRect>();
  if (!container) {
    return map;
  }
  const cards = container.querySelectorAll<HTMLElement>(".account-row[data-uid]");
  for (const card of cards) {
    const uid = card.dataset.uid;
    if (!uid) {
      continue;
    }
    map.set(uid, card.getBoundingClientRect());
  }
  return map;
}

function playFlipForContainer(
  container: HTMLElement | null,
  previousPositions: Map<string, DOMRect>,
  duration: number
): void {
  if (!container || !previousPositions.size) {
    return;
  }
  const cards = container.querySelectorAll<HTMLElement>(".account-row[data-uid]");
  for (const card of cards) {
    const uid = card.dataset.uid;
    if (!uid) {
      continue;
    }
    const previousRect = previousPositions.get(uid);
    if (!previousRect) {
      continue;
    }
    const nextRect = card.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      continue;
    }

    const previousAnimation = flipAnimationMap.get(card);
    previousAnimation?.cancel();
    const animation = card.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px)` },
        { transform: "translate(0, 0)" }
      ],
      {
        duration,
        easing: "ease-out"
      }
    );
    flipAnimationMap.set(card, animation);
    animation.onfinish = () => {
      if (flipAnimationMap.get(card) === animation) {
        flipAnimationMap.delete(card);
      }
    };
  }
}

function animateCardReflowAfterSplit(
  previousLeft: Map<string, DOMRect>,
  previousRight: Map<string, DOMRect>,
  duration: number
): void {
  void nextTick(() => {
    if (splitFlipFrame) {
      cancelAnimationFrame(splitFlipFrame);
    }
    splitFlipFrame = requestAnimationFrame(() => {
      playFlipForContainer(leftGridRef.value, previousLeft, duration);
      playFlipForContainer(rightGridRef.value, previousRight, duration);
      splitFlipFrame = null;
    });
  });
}

function updateSplitRatio(
  normalized: number,
  options?: { animate?: boolean; duration?: number }
): void {
  if (Math.abs(normalized - splitRatio.value) < 0.1) {
    return;
  }
  const shouldAnimate = options?.animate ?? !isDraggingDivider.value;
  if (!shouldAnimate) {
    splitRatio.value = normalized;
    return;
  }
  const previousLeft = captureCardPositions(leftGridRef.value);
  const previousRight = captureCardPositions(rightGridRef.value);
  splitRatio.value = normalized;
  animateCardReflowAfterSplit(
    previousLeft,
    previousRight,
    options?.duration ?? 520
  );
}

function updateSplitByClientX(
  clientX: number,
  options?: { animate?: boolean; duration?: number }
): void {
  const container = splitContainerRef.value;
  if (!container) {
    return;
  }
  const rect = container.getBoundingClientRect();
  if (rect.width <= 0) {
    return;
  }
  const next = ((clientX - rect.left) / rect.width) * 100;
  const normalized = Math.max(20, Math.min(80, next));
  updateSplitRatio(normalized, options);
}

function flushDragMoveFrame(): void {
  dragMoveFrame = null;
  if (!isDraggingDivider.value || latestDragClientX === null) {
    return;
  }
  updateSplitByClientX(latestDragClientX, { animate: false });
}

function scheduleDragSplitUpdate(clientX: number): void {
  latestDragClientX = clientX;
  if (dragMoveFrame !== null) {
    return;
  }
  dragMoveFrame = requestAnimationFrame(flushDragMoveFrame);
}

function stopDividerDrag(): void {
  if (!isDraggingDivider.value) {
    return;
  }
  isDraggingDivider.value = false;
  latestDragClientX = null;
  if (dragMoveFrame !== null) {
    cancelAnimationFrame(dragMoveFrame);
    dragMoveFrame = null;
  }
  window.removeEventListener("pointermove", handleDividerPointerMove);
  window.removeEventListener("pointerup", stopDividerDrag);
}

function handleDividerPointerMove(event: PointerEvent): void {
  if (!isDraggingDivider.value) {
    return;
  }
  scheduleDragSplitUpdate(event.clientX);
}

function startDividerDrag(event: PointerEvent): void {
  if (window.innerWidth <= 980) {
    return;
  }
  isDraggingDivider.value = true;
  latestDragClientX = event.clientX;
  updateSplitByClientX(event.clientX, { animate: false });
  window.addEventListener("pointermove", handleDividerPointerMove);
  window.addEventListener("pointerup", stopDividerDrag);
}

function adjustSplitByKeyboard(delta: number): void {
  const next = Math.max(20, Math.min(80, splitRatio.value + delta));
  updateSplitRatio(next, { animate: true, duration: 620 });
}

let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

function resetAutoRefreshTimer(): void {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (!isAuthenticated.value) {
    return;
  }
  if (autoRefreshSeconds.value <= 0) {
    return;
  }
  autoRefreshTimer = setInterval(() => {
    void refreshAccounts({ silent: true, forceRefresh: false });
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

watch(isAuthenticated, (value) => {
  if (value) {
    void refreshAccounts();
    resetAutoRefreshTimer();
    return;
  }
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
});

onMounted(async () => {
  applyThemeToDocument(themeMode.value);
  await loadRuntimeConfig();
  if (isAuthenticated.value) {
    void refreshAccounts();
    resetAutoRefreshTimer();
  }
});

onBeforeUnmount(() => {
  stopDividerDrag();
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  if (dragMoveFrame !== null) {
    cancelAnimationFrame(dragMoveFrame);
    dragMoveFrame = null;
  }
  if (splitFlipFrame) {
    cancelAnimationFrame(splitFlipFrame);
    splitFlipFrame = null;
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
    <div v-if="isAuthenticated" class="app-shell">
      <header class="app-toolbar">
        <div class="app-toolbar__title">
          <h1>账号额度面板</h1>
          <p>平台地址与 Key 由 Cloudflare 配置；可在配置中心开关模块与排序</p>
        </div>
        <div class="app-toolbar__actions">
          <NSpace align="center" wrap>
            <NButton
              :type="selectionMode ? 'primary' : 'default'"
              tertiary
              @click="toggleSelectionMode"
            >
              {{ selectionMode ? "退出批量" : "批量管理" }}
            </NButton>
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
            <NButton tertiary @click="logout">退出登录</NButton>
          </NSpace>
          <p class="app-toolbar__quota-tip">
            用量以 Sub2API 官方统计为准，仅展示已用比例与实际费用，不再推算总额度
          </p>
        </div>
      </header>

      <p v-if="errors.length" class="error-strip">
        {{ errors[0] }}
      </p>

      <div v-if="selectionMode" class="batch-toolbar">
        <span class="batch-toolbar__meta">已选 {{ selectedCount }} 个账号</span>
        <NSpace wrap>
          <NButton size="small" @click="selectAccountsByPlatform('sub2api')" :disabled="!sub2apiVisible">
            全选 Sub2API
          </NButton>
          <NButton size="small" @click="selectAccountsByPlatform('cliproxyapi')" :disabled="!cpaVisible">
            全选 CPA
          </NButton>
          <NButton size="small" :disabled="!selectedCount" @click="clearAccountSelection">
            清空选择
          </NButton>
          <NButton size="small" :disabled="!selectedCount" @click="openBatchEditModal">
            批量编辑
          </NButton>
          <NButton size="small" :disabled="!selectedCount" @click="handleBatchEnable(true)">
            批量启用
          </NButton>
          <NButton size="small" :disabled="!selectedCount" @click="handleBatchEnable(false)">
            批量停用
          </NButton>
          <NButton size="small" :disabled="!selectedCount" @click="openBatchRenameModal">
            批量重命名(邮箱)
          </NButton>
        </NSpace>
      </div>

      <main
        v-if="visiblePaneCount > 0"
        ref="splitContainerRef"
        class="account-split"
        :class="{
          'account-split--dragging': isDraggingDivider,
          'account-split--single-pane': visiblePaneCount === 1
        }"
      >
        <section v-if="sub2apiVisible" class="platform-pane" :style="leftPaneStyle">
          <div class="platform-pane__head">
            <div class="platform-pane__head-left">
              <h2>sub2api</h2>
            </div>
            <div class="platform-pane__head-meta">
              <span class="platform-pane__total">{{ sub2apiAccounts.length }} 个账号</span>
              <div class="platform-pane__status-list">
                <span class="status-chip status-chip--normal">正常 {{ sub2apiStateSummary.normal }}</span>
                <span class="status-chip status-chip--exhausted">用尽 {{ sub2apiStateSummary.exhausted }}</span>
                <span class="status-chip status-chip--banned">封禁 {{ sub2apiStateSummary.banned }}</span>
                <span class="status-chip status-chip--disabled">停用 {{ sub2apiStateSummary.disabled }}</span>
                <span class="status-chip status-chip--error">异常 {{ sub2apiStateSummary.error }}</span>
              </div>
            </div>
          </div>
          <NScrollbar class="pane-scroll">
            <div ref="leftGridRef" class="account-list">
              <AccountQuotaCard
                v-for="account in sub2apiAccounts"
                :key="account.uid"
                :data-uid="account.uid"
                :account="account"
                :metrics="getMetrics(account)"
                :selection-mode="selectionMode"
                :selected="isAccountSelected(account.uid)"
                @copy-email="handleCopyEmail"
                @open-context-menu="openContextMenu"
                @toggle-select="toggleAccountSelection"
              />
              <p v-if="!sub2apiAccounts.length" class="pane-empty">暂无账号</p>
            </div>
          </NScrollbar>
        </section>

        <div
          v-if="sub2apiVisible && cpaVisible"
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

        <section v-if="cpaVisible" class="platform-pane" :style="rightPaneStyle">
          <div class="platform-pane__head">
            <div class="platform-pane__head-left">
              <h2>cpa</h2>
            </div>
            <div class="platform-pane__head-meta">
              <span class="platform-pane__total">{{ cpaAccounts.length }} 个账号</span>
              <div class="platform-pane__status-list">
                <span class="status-chip status-chip--normal">正常 {{ cpaStateSummary.normal }}</span>
                <span class="status-chip status-chip--exhausted">用尽 {{ cpaStateSummary.exhausted }}</span>
                <span class="status-chip status-chip--banned">封禁 {{ cpaStateSummary.banned }}</span>
                <span class="status-chip status-chip--disabled">停用 {{ cpaStateSummary.disabled }}</span>
                <span class="status-chip status-chip--error">异常 {{ cpaStateSummary.error }}</span>
              </div>
            </div>
          </div>
          <NScrollbar class="pane-scroll">
            <div ref="rightGridRef" class="account-list">
              <AccountQuotaCard
                v-for="account in cpaAccounts"
                :key="account.uid"
                :data-uid="account.uid"
                :account="account"
                :metrics="getMetrics(account)"
                :selection-mode="selectionMode"
                :selected="isAccountSelected(account.uid)"
                @copy-email="handleCopyEmail"
                @open-context-menu="openContextMenu"
                @toggle-select="toggleAccountSelection"
              />
              <p v-if="!cpaAccounts.length" class="pane-empty">暂无账号</p>
            </div>
          </NScrollbar>
        </section>
      </main>
      <p v-else class="account-split--empty">
        当前未启用任何平台模块，请在右下角配置中心开启 Sub2API 或 CPA 的「主页显示」。
      </p>

      <footer class="app-footer">
        <div class="app-footer__inner">
          <span>Copyright © {{ currentYear }}</span>
          <a
            class="app-footer__link"
            href="https://github.com/Msg-Lbo"
            target="_blank"
            rel="noopener noreferrer"
          >
            Msg-Lbo
          </a>
          <span class="app-footer__divider">|</span>
          <a
            class="app-footer__link"
            href="https://github.com/Msg-Lbo/unified-admin-panel"
            target="_blank"
            rel="noopener noreferrer"
          >
            项目 GitHub
          </a>
        </div>
      </footer>

      <NDropdown
        trigger="manual"
        placement="bottom-start"
        :show="contextMenuVisible"
        :x="contextMenuX"
        :y="contextMenuY"
        :options="contextMenuOptions"
        @clickoutside="closeContextMenu"
        @select="handleContextMenuSelect"
      />

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
        @update-platform-enabled="updatePlatformEnabled"
        @update-sort-setting="updateSortSetting"
        @save-settings="saveSettings"
        @test-platform="testConnection"
      />

      <AccountManageModals
        :show-batch-edit="showBatchEditModal"
        :show-rename="showRenameModal"
        :accounts="showRenameModal ? renameTargetAccounts : selectedAccounts"
        :rename-mode="renameMode"
        :submitting="manageSubmitting"
        @update:show-batch-edit="(value) => (showBatchEditModal = value)"
        @update:show-rename="(value) => (showRenameModal = value)"
        @submit-batch-edit="applyBatchEdit"
        @submit-rename="applyRename"
      />

      <AccountJsonModal
        :show="showJsonModal"
        :account="jsonViewAccount"
        @update:show="(value) => (showJsonModal = value)"
      />
    </div>
    <div v-else class="auth-page">
      <section class="auth-card">
        <h1>统一管理面板登录</h1>
        <p class="auth-card__subtitle">请输入密码或 Token，任一项正确后即可进入。</p>
        <NInput
          v-model:value="loginPassword"
          type="password"
          placeholder="密码（可选）"
          show-password-on="mousedown"
          @keydown.enter.prevent="handleLogin"
        />
        <NInput
          v-model:value="loginToken"
          placeholder="Token（可选）"
          @keydown.enter.prevent="handleLogin"
        />
        <p v-if="loginError" class="auth-card__error">{{ loginError }}</p>
        <NButton type="primary" block @click="handleLogin">登录进入</NButton>
      </section>
    </div>
  </NConfigProvider>
</template>

