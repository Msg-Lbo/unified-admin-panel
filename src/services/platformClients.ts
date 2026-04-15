import axios, { type AxiosRequestConfig, type Method } from "axios";
import type {
  AccountDetailResult,
  PlatformConfig,
  PlatformFetchResult,
  PlatformUsageTrend,
  UnifiedAccount
} from "../types/platform";
import { estimateTokenUsageCostUsd } from "../utils/pricing";

interface CLIProxyAuthFile {
  id?: string;
  auth_index?: string;
  name?: string;
  type?: string;
  provider?: string;
  status?: string;
  status_message?: string;
  disabled?: boolean;
  email?: string;
  account?: string;
  id_token?: unknown;
  credentials?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  chatgpt_account_id?: string;
  chatgptAccountId?: string;
  plan_type?: string;
  planType?: string;
  updated_at?: string;
  modtime?: string;
  last_refresh?: string;
  note?: string;
  priority?: number | string;
}

interface CLIProxyListResponse {
  files?: CLIProxyAuthFile[];
}

interface CLIProxyModelsResponse {
  models?: Array<Record<string, unknown>>;
}

interface CLIProxyUsageResponse {
  usage?: CLIProxyUsageSnapshot;
}

interface CLIProxyUsageSnapshot {
  tokens_by_day?: Record<string, number | string>;
  requests_by_day?: Record<string, number | string>;
  apis?: Record<string, CLIProxyUsageApiSnapshot>;
}

interface CLIProxyUsageApiSnapshot {
  models?: Record<string, CLIProxyUsageModelSnapshot>;
}

interface CLIProxyUsageModelSnapshot {
  details?: CLIProxyUsageDetail[];
}

interface CLIProxyUsageDetail {
  timestamp?: string;
  source?: string;
  auth_index?: string;
  failed?: boolean;
  tokens?: {
    total_tokens?: number | string;
    input_tokens?: number | string;
    output_tokens?: number | string;
    reasoning_tokens?: number | string;
    cached_tokens?: number | string;
    cache_read_tokens?: number | string;
    cache_creation_tokens?: number | string;
  };
}

interface Sub2ApiEnvelope<T> {
  code: number;
  message: string;
  data?: T;
}

interface Sub2ApiPaginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
}

interface Sub2ApiTrendPoint {
  date?: string;
  total_tokens?: number;
  tokens?: number;
}

interface Sub2ApiDashboardTrendPayload {
  trend?: Sub2ApiTrendPoint[];
}

type Sub2ApiAccount = Record<string, unknown> & {
  id?: number | string;
  name?: string;
  platform?: string;
  type?: string;
  status?: string;
  updated_at?: string;
  credentials?: Record<string, unknown>;
  notes?: string;
  priority?: number;
  error_message?: string;
  schedulable?: boolean;
  rate_limited_at?: string;
  rate_limit_reset_at?: string;
  overload_until?: string;
  temp_unschedulable_until?: string;
  temp_unschedulable_reason?: string;
  session_window_status?: string;
  quota_limit?: number | string;
  quota_used?: number | string;
  quota_daily_limit?: number | string;
  quota_daily_used?: number | string;
  quota_weekly_limit?: number | string;
  quota_weekly_used?: number | string;
};

interface ProxyRequestPayload {
  url: string;
  method: string;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  data?: unknown;
}

interface CLIProxyApiCallResponse {
  status_code?: number;
  statusCode?: number;
  body?: unknown;
}

interface TrendFetchResult {
  trend: PlatformUsageTrend;
  errors: string[];
}

interface CLIProxyUsageCostEstimate {
  estimated_used_usd: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  requests: number;
}

const SUB2_ACCOUNT_STATS_CACHE_TTL_MS = 90_000;
const SUB2_ACCOUNT_USAGE_WINDOW_CACHE_TTL_MS = 45_000;
const CPA_USAGE_COST_WINDOW_DAYS = 7;
const sub2AccountStatsCache = new Map<
  string,
  { expiresAt: number; payload: Record<string, unknown> }
>();
const sub2AccountUsageWindowCache = new Map<
  string,
  { expiresAt: number; payload: Record<string, unknown> }
>();

export interface EditAccountPayload {
  name?: string;
  note?: string;
  priority?: number;
}

export interface BatchEditPayload {
  note?: string;
  priority?: number;
}

const PROXY_ENDPOINT = "/api/proxy";
const REQUEST_MODE_STORAGE_KEY = "unified-admin-panel.request-mode";
const CPA_CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CPA_CODEX_USER_AGENT =
  "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal";

const request = axios.create({
  timeout: 20000
});

const SUB2API_QUOTA_HINTS = [
  "usage_limit_reached",
  "usage limit has been reached",
  "insufficient_quota",
  "insufficient quota",
  "quota exhausted",
  "quota exceeded",
  "quota reached",
  "billing_hard_limit",
  "billing hard limit",
  "credit balance is too low",
  "out of credits",
  "额度",
  "用完"
];

const SUB2API_RATE_LIMIT_HINTS = [
  "rate limit",
  "rate_limited",
  "rate_limit",
  "429",
  "too many requests",
  "retry after"
];

const SUB2API_BANNED_HINTS = [
  "account_deactivated",
  "deactivated",
  "account disabled",
  "suspended",
  "banned",
  "forbidden"
];

function pickFirstString(
  ...values: Array<string | number | undefined | null>
): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }
    const normalized = String(value).trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return undefined;
}

function parseCLIProxyStatusMessage(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const parsedError =
      parsed.error && typeof parsed.error === "object"
        ? (parsed.error as Record<string, unknown>)
        : undefined;
    return (
      pickFirstString(
        parsedError?.message as string | undefined,
        parsedError?.type as string | undefined,
        parsed.message as string | undefined
      ) ?? trimmed
    );
  } catch {
    return trimmed;
  }
}

function parseSub2ApiStatusMessage(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const parsedError =
      parsed.error && typeof parsed.error === "object"
        ? (parsed.error as Record<string, unknown>)
        : undefined;
    return (
      pickFirstString(
        parsedError?.message as string | undefined,
        parsedError?.type as string | undefined,
        parsed.message as string | undefined,
        parsed.type as string | undefined,
        parsed.error_message as string | undefined
      ) ?? trimmed
    );
  } catch {
    return trimmed;
  }
}

function decodeBase64UrlSegment(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return atob(padded);
  } catch {
    return undefined;
  }
}

function parseIdTokenPayload(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Continue to JWT parsing.
  }
  const segments = trimmed.split(".");
  if (segments.length < 2) {
    return undefined;
  }
  const payloadText = decodeBase64UrlSegment(segments[1]);
  if (!payloadText) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(payloadText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function resolveCLIProxyCodexAccountId(file: CLIProxyAuthFile): string | undefined {
  const metadata =
    file.metadata && typeof file.metadata === "object" ? file.metadata : undefined;
  const attributes =
    file.attributes && typeof file.attributes === "object" ? file.attributes : undefined;
  const credentials =
    file.credentials && typeof file.credentials === "object"
      ? file.credentials
      : undefined;

  const directCandidate = pickFirstString(
    file.chatgpt_account_id,
    file.chatgptAccountId,
    metadata?.chatgpt_account_id as string | undefined,
    metadata?.chatgptAccountId as string | undefined,
    attributes?.chatgpt_account_id as string | undefined,
    attributes?.chatgptAccountId as string | undefined,
    credentials?.chatgpt_account_id as string | undefined,
    credentials?.chatgptAccountId as string | undefined
  );
  if (directCandidate) {
    return directCandidate;
  }

  const idTokenCandidates: unknown[] = [
    file.id_token,
    metadata?.id_token,
    attributes?.id_token,
    credentials?.id_token
  ];

  for (const candidate of idTokenCandidates) {
    const payload = parseIdTokenPayload(candidate);
    if (!payload) {
      continue;
    }
    const accountId = pickFirstString(
      payload.chatgpt_account_id as string | undefined,
      payload.chatgptAccountId as string | undefined
    );
    if (accountId) {
      return accountId;
    }
  }
  return undefined;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function parseApiCallBody(body: unknown): Record<string, unknown> | undefined {
  const direct = toRecord(body);
  if (direct) {
    return direct;
  }
  if (typeof body !== "string") {
    return undefined;
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return toRecord(parsed);
  } catch {
    return undefined;
  }
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const results: T[] = new Array(tasks.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) {
        return;
      }
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from(
    { length: Math.min(normalizedLimit, tasks.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

function normalizeStatus(
  rawStatus?: string,
  disabled?: boolean,
  statusMessage?: string
): { status: string; statusDetail?: string } {
  if (disabled) {
    return { status: "disabled", statusDetail: statusMessage };
  }
  const normalizedStatus = rawStatus?.trim().toLowerCase() || "unknown";
  const normalizedMessage = (statusMessage ?? "").toLowerCase();
  if (
    normalizedStatus === "error" &&
    (normalizedMessage.includes("usage_limit_reached") ||
      normalizedMessage.includes("usage limit has been reached") ||
      normalizedMessage.includes("quota"))
  ) {
    return {
      status: "quota_exhausted",
      statusDetail: statusMessage
    };
  }
  return {
    status: normalizedStatus,
    statusDetail: statusMessage
  };
}

function containsAnyKeyword(source: string, keywords: string[]): boolean {
  if (!source.trim()) {
    return false;
  }
  const normalized = source.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function hasReachedQuotaLimit(item: Sub2ApiAccount): boolean {
  const quotaPairs: Array<[string, string]> = [
    ["quota_limit", "quota_used"],
    ["quota_daily_limit", "quota_daily_used"],
    ["quota_weekly_limit", "quota_weekly_used"]
  ];
  for (const [limitKey, usedKey] of quotaPairs) {
    const limit = numberFromUnknown(item[limitKey]);
    const used = numberFromUnknown(item[usedKey]);
    if (limit > 0 && used >= limit - Number.EPSILON) {
      return true;
    }
  }
  return false;
}

function isFutureTime(value?: string): boolean {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }
  return parsed.getTime() > Date.now();
}

function normalizeSub2ApiStatus(
  item: Sub2ApiAccount
): { status: string; statusDetail?: string } {
  const normalizedStatus = item.status?.trim().toLowerCase() || "unknown";
  const errorMessage = parseSub2ApiStatusMessage(item.error_message);
  const tempUnschedulableReason = parseSub2ApiStatusMessage(
    item.temp_unschedulable_reason
  );
  const schedulable =
    typeof item.schedulable === "boolean" ? item.schedulable : undefined;
  const rateLimitedAt = pickFirstString(item.rate_limited_at);
  const rateLimitResetAt = pickFirstString(item.rate_limit_reset_at);
  const overloadUntil = pickFirstString(item.overload_until);
  const tempUnschedulableUntil = pickFirstString(item.temp_unschedulable_until);
  const sessionWindowStatus = pickFirstString(item.session_window_status);

  const detailParts: string[] = [];
  if (errorMessage) {
    detailParts.push(errorMessage);
  }
  if (tempUnschedulableReason) {
    detailParts.push(tempUnschedulableReason);
  }
  if (sessionWindowStatus) {
    detailParts.push(`session_window=${sessionWindowStatus}`);
  }
  if (rateLimitResetAt) {
    detailParts.push(`rate_limit_reset_at=${rateLimitResetAt}`);
  }
  if (tempUnschedulableUntil) {
    detailParts.push(`temp_unschedulable_until=${tempUnschedulableUntil}`);
  }
  if (schedulable === false) {
    detailParts.push("schedulable=false");
  }
  const statusDetail = detailParts.length > 0 ? detailParts.join(" | ") : undefined;

  const messageText = [errorMessage, tempUnschedulableReason, sessionWindowStatus]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const signalText = `${normalizedStatus} ${messageText}`;
  const statusIsBanned =
    normalizedStatus.includes("banned") ||
    normalizedStatus.includes("deactivated") ||
    normalizedStatus.includes("suspended");
  const bannedByMessage = containsAnyKeyword(signalText, SUB2API_BANNED_HINTS);

  if (statusIsBanned || (normalizedStatus === "error" && bannedByMessage)) {
    return {
      status: "banned",
      statusDetail
    };
  }

  const tempUnschedulableActive = isFutureTime(tempUnschedulableUntil);
  const overloadActive = isFutureTime(overloadUntil);
  const rateLimitResetActive = isFutureTime(rateLimitResetAt);
  const statusIsQuota =
    normalizedStatus.includes("quota") ||
    normalizedStatus.includes("exhausted") ||
    normalizedStatus.includes("insufficient");

  const hasExplicitFailureSignal =
    statusIsQuota ||
    normalizedStatus === "error" ||
    schedulable === false ||
    tempUnschedulableActive ||
    overloadActive;

  const quotaByKeyword = containsAnyKeyword(signalText, SUB2API_QUOTA_HINTS);
  const quotaByNumbers = hasReachedQuotaLimit(item);
  if (quotaByNumbers || (quotaByKeyword && hasExplicitFailureSignal)) {
    return {
      status: "quota_exhausted",
      statusDetail
    };
  }

  const statusIsRateLimited =
    normalizedStatus.includes("rate_limited") ||
    normalizedStatus.includes("rate-limit") ||
    normalizedStatus === "ratelimited";
  const rateLimitedByMessage = containsAnyKeyword(messageText, SUB2API_RATE_LIMIT_HINTS);
  const rateLimitWindowActive =
    tempUnschedulableActive || overloadActive || rateLimitResetActive;
  const rateLimitedActive =
    rateLimitWindowActive ||
    (normalizedStatus === "error" && rateLimitedByMessage) ||
    (statusIsRateLimited &&
      (rateLimitedByMessage ||
        rateLimitWindowActive ||
        (Boolean(rateLimitedAt) && rateLimitResetActive)));
  if (rateLimitedActive) {
    return {
      status: "rate_limited",
      statusDetail
    };
  }

  if (normalizedStatus === "inactive" || normalizedStatus === "disabled") {
    return {
      status: "disabled",
      statusDetail
    };
  }

  if (schedulable === false && normalizedStatus === "active") {
    return {
      status: "inactive",
      statusDetail
    };
  }

  if (normalizedStatus === "error") {
    return {
      status: "error",
      statusDetail
    };
  }

  return {
    status: normalizedStatus,
    statusDetail
  };
}

function extractAccountName(
  primaryName?: string,
  fallbackEmail?: string,
  fallbackId?: string
): string {
  return (
    pickFirstString(primaryName, fallbackEmail, fallbackId) ?? "Unnamed account"
  );
}

function normalizePriority(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data;
    if (typeof responseData === "string" && responseData.trim()) {
      const normalized = responseData.trim();
      if (normalized.includes("error code: 1003")) {
        return "Cloudflare 拒绝通过 IP 访问上游（1003），请将平台地址改为域名。";
      }
      return normalized;
    }
    if (responseData && typeof responseData === "object") {
      const payload = responseData as Record<string, unknown>;
      const payloadError =
        payload.error && typeof payload.error === "object"
          ? (payload.error as Record<string, unknown>)
          : undefined;
      const messageCandidate = pickFirstString(
        payloadError?.message as string | undefined,
        payloadError?.type as string | undefined,
        payload.error as string | undefined,
        payload.message as string | undefined
      );
      if (messageCandidate) {
        return messageCandidate;
      }
    }
    if (error.message) {
      return error.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown request error";
}

function unwrapSub2Api<T>(payload: Sub2ApiEnvelope<T>, fallbackMessage: string): T {
  if (typeof payload.code === "number" && payload.code !== 0) {
    throw new Error(payload.message || fallbackMessage);
  }
  return payload.data as T;
}

function ensureNumericAccountId(account: UnifiedAccount): number {
  const parsed = Number.parseInt(account.manageKey, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid sub2api account id: ${account.manageKey}`);
  }
  return parsed;
}

function getSub2AccountStatsCacheKey(platform: PlatformConfig, accountId: number): string {
  return `${sanitizeBaseUrl(platform.baseUrl)}::${accountId}`;
}

function readSub2AccountStatsCache(
  platform: PlatformConfig,
  accountId: number
): Record<string, unknown> | undefined {
  const cacheKey = getSub2AccountStatsCacheKey(platform, accountId);
  const cached = sub2AccountStatsCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt <= Date.now()) {
    sub2AccountStatsCache.delete(cacheKey);
    return undefined;
  }
  return cached.payload;
}

function writeSub2AccountStatsCache(
  platform: PlatformConfig,
  accountId: number,
  payload: Record<string, unknown>
): void {
  const cacheKey = getSub2AccountStatsCacheKey(platform, accountId);
  sub2AccountStatsCache.set(cacheKey, {
    expiresAt: Date.now() + SUB2_ACCOUNT_STATS_CACHE_TTL_MS,
    payload
  });
}

function readSub2AccountUsageWindowCache(
  platform: PlatformConfig,
  accountId: number
): Record<string, unknown> | undefined {
  const cacheKey = getSub2AccountStatsCacheKey(platform, accountId);
  const cached = sub2AccountUsageWindowCache.get(cacheKey);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt <= Date.now()) {
    sub2AccountUsageWindowCache.delete(cacheKey);
    return undefined;
  }
  return cached.payload;
}

function writeSub2AccountUsageWindowCache(
  platform: PlatformConfig,
  accountId: number,
  payload: Record<string, unknown>
): void {
  const cacheKey = getSub2AccountStatsCacheKey(platform, accountId);
  sub2AccountUsageWindowCache.set(cacheKey, {
    expiresAt: Date.now() + SUB2_ACCOUNT_USAGE_WINDOW_CACHE_TTL_MS,
    payload
  });
}

function getRequiredApiKey(platform: PlatformConfig): string {
  const apiKey = platform.apiKey.trim();
  if (!apiKey) {
    throw new Error("API key is required.");
  }
  return apiKey;
}

function getCLIProxyHeaders(platform: PlatformConfig): Record<string, string> {
  const apiKey = getRequiredApiKey(platform);
  return {
    Authorization: `Bearer ${apiKey}`,
    "X-Management-Key": apiKey
  };
}

function getSub2ApiHeaders(platform: PlatformConfig): Record<string, string> {
  const apiKey = getRequiredApiKey(platform);
  return {
    "x-api-key": apiKey,
    Authorization: `Bearer ${apiKey}`
  };
}

function ensurePlatformReady(platform: PlatformConfig): string {
  const baseUrl = sanitizeBaseUrl(platform.baseUrl);
  if (!baseUrl) {
    throw new Error("Base URL is required.");
  }
  getRequiredApiKey(platform);
  return baseUrl;
}

function shouldPreferProxy(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const configured = window.localStorage.getItem(REQUEST_MODE_STORAGE_KEY);
  if (configured === "direct") {
    return false;
  }
  if (configured === "proxy") {
    return true;
  }
  return true;
}

function isProxyUnavailable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const statusCode = error.response?.status;
  if (statusCode === 404 || statusCode === 405 || statusCode === 501) {
    return true;
  }
  const requestedUrl = error.config?.url ?? "";
  return requestedUrl.includes(PROXY_ENDPOINT) && !statusCode;
}

async function requestDirect<T>(config: AxiosRequestConfig): Promise<T> {
  const { data } = await request.request<T>(config);
  return data;
}

async function requestByProxy<T>(config: AxiosRequestConfig): Promise<T> {
  const payload: ProxyRequestPayload = {
    url: String(config.url),
    method: String(config.method ?? "GET").toUpperCase(),
    headers: (config.headers ?? {}) as Record<string, string>,
    params: (config.params ?? {}) as Record<string, unknown>,
    data: config.data
  };
  const { data } = await request.post<T>(PROXY_ENDPOINT, payload, {
    timeout: config.timeout ?? 20000
  });
  return data;
}

async function requestWithFallback<T>(config: AxiosRequestConfig): Promise<T> {
  if (!shouldPreferProxy()) {
    return requestDirect<T>(config);
  }
  try {
    return await requestByProxy<T>(config);
  } catch (error) {
    if (!isProxyUnavailable(error)) {
      throw error;
    }
    return requestDirect<T>(config);
  }
}

async function fetchCLIProxyCodexUsage(
  platform: PlatformConfig,
  authIndex: string,
  accountId: string
): Promise<Record<string, unknown> | undefined> {
  const baseUrl = ensurePlatformReady(platform);
  const response = await requestWithFallback<CLIProxyApiCallResponse>({
    method: "POST",
    url: `${baseUrl}/v0/management/api-call`,
    timeout: 12000,
    headers: getCLIProxyHeaders(platform),
    data: {
      auth_index: authIndex,
      method: "GET",
      url: CPA_CODEX_USAGE_URL,
      header: {
        Authorization: "Bearer $TOKEN$",
        "Content-Type": "application/json",
        "User-Agent": CPA_CODEX_USER_AGENT,
        "Chatgpt-Account-Id": accountId
      }
    }
  });

  const statusCode = Number(response.status_code ?? response.statusCode ?? 0);
  if (statusCode < 200 || statusCode >= 300) {
    return undefined;
  }
  return parseApiCallBody(response.body);
}

async function buildCLIProxyQuotaByAuthIndex(
  platform: PlatformConfig,
  files: CLIProxyAuthFile[]
): Promise<Map<string, Record<string, unknown>>> {
  const jobs: Array<{
    authIndex: string;
    task: () => Promise<Record<string, unknown> | undefined>;
  }> = [];

  for (const file of files) {
    const provider = pickFirstString(file.provider, file.type)?.toLowerCase();
    if (provider !== "codex") {
      continue;
    }
    const authIndex = pickFirstString(file.auth_index);
    if (!authIndex) {
      continue;
    }
    const accountId = resolveCLIProxyCodexAccountId(file);
    if (!accountId) {
      continue;
    }
    jobs.push({
      authIndex,
      task: () => fetchCLIProxyCodexUsage(platform, authIndex, accountId)
    });
  }

  const resultMap = new Map<string, Record<string, unknown>>();
  if (!jobs.length) {
    return resultMap;
  }

  const results = await runWithConcurrency(
    jobs.map(({ task }) => async () => {
      try {
        return await task();
      } catch {
        return undefined;
      }
    }),
    4
  );

  for (let i = 0; i < jobs.length; i += 1) {
    const payload = results[i];
    if (payload && Object.keys(payload).length > 0) {
      resultMap.set(jobs[i].authIndex, payload);
    }
  }
  return resultMap;
}

function mapCLIProxyFileToUnified(
  platform: PlatformConfig,
  item: CLIProxyAuthFile,
  index: number,
  quotaUsage?: Record<string, unknown>,
  usageCostEstimate?: CLIProxyUsageCostEstimate
): UnifiedAccount {
  const accountId =
    pickFirstString(item.id, item.name, item.auth_index) ??
    `cliproxy-${index + 1}`;
  const manageKey = pickFirstString(item.id, item.name, accountId) ?? accountId;
  const name = extractAccountName(item.name, item.email, accountId);
  const type = pickFirstString(item.provider, item.type) ?? "unknown";
  const statusMessage = parseCLIProxyStatusMessage(item.status_message);
  const statusResult = normalizeStatus(item.status, item.disabled, statusMessage);
  const email = pickFirstString(item.email, item.account);
  const updatedAt = pickFirstString(
    item.updated_at,
    item.modtime,
    item.last_refresh
  );
  const priority = normalizePriority(item.priority);
  const note = pickFirstString(item.note);

  const rawPayload: Record<string, unknown> = {
    ...(item as Record<string, unknown>)
  };
  if (quotaUsage) {
    rawPayload.cpa_quota_usage = quotaUsage;
  }
  if (usageCostEstimate) {
    rawPayload.cpa_usage_cost_estimate = usageCostEstimate;
  }

  return {
    uid: `${platform.id}:${accountId}`,
    platform: platform.id,
    platformName: platform.name,
    accountId,
    manageKey,
    name,
    type,
    status: statusResult.status,
    statusDetail: statusResult.statusDetail,
    email,
    note,
    priority,
    updatedAt,
    raw: rawPayload
  };
}

function mapSub2ApiAccountToUnified(
  platform: PlatformConfig,
  item: Sub2ApiAccount,
  index: number,
  usageStats?: Record<string, unknown>,
  usageWindow?: Record<string, unknown>
): UnifiedAccount {
  const accountId =
    pickFirstString(item.id as string | number | undefined) ??
    `sub2api-${index + 1}`;
  const manageKey = accountId;
  const credentials = item.credentials ?? {};
  const credentialEmail =
    typeof credentials.email === "string" ? credentials.email : undefined;
  const type =
    pickFirstString(item.platform as string, item.type as string) ?? "unknown";
  const name = extractAccountName(item.name, credentialEmail, accountId);
  const statusResult = normalizeSub2ApiStatus(item);
  const updatedAt = pickFirstString(item.updated_at as string);
  const note = pickFirstString(item.notes as string | undefined);
  const priority = normalizePriority(item.priority);

  const rawPayload: Record<string, unknown> = {
    ...(item as Record<string, unknown>)
  };
  if (usageStats) {
    rawPayload.sub2_usage_stats = usageStats;
  }
  if (usageWindow) {
    rawPayload.sub2_usage_window = usageWindow;
  }

  return {
    uid: `${platform.id}:${accountId}`,
    platform: platform.id,
    platformName: platform.name,
    accountId,
    manageKey,
    name,
    type,
    status: statusResult.status,
    statusDetail: statusResult.statusDetail,
    email: credentialEmail,
    note,
    priority,
    updatedAt,
    raw: rawPayload
  };
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildDateKeys(days: number): string[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const keys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const current = new Date(today);
    current.setDate(today.getDate() - offset);
    keys.push(formatDateKey(current));
  }
  return keys;
}

function dateLabelFromKey(key: string): string {
  return key.slice(5);
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function createEmptyCLIProxyUsageCostEstimate(): CLIProxyUsageCostEstimate {
  return {
    estimated_used_usd: 0,
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    requests: 0
  };
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function pickFirstNonNegativeNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const numeric = toOptionalNumber(value);
    if (typeof numeric === "number" && numeric >= 0) {
      return numeric;
    }
  }
  return undefined;
}

function toUsageDateKey(timestamp: unknown): string | undefined {
  if (typeof timestamp !== "string") {
    return undefined;
  }
  const key = timestamp.trim().slice(0, 10);
  if (isDateKey(key)) {
    return key;
  }
  return undefined;
}

function extractCLIProxyDetailUsedUsd(detail: CLIProxyUsageDetail): number | undefined {
  const raw = detail as unknown as Record<string, unknown>;
  const billing = toRecord(raw.billing);
  const metrics = toRecord(raw.metrics);
  const usage = toRecord(raw.usage);
  return pickFirstNonNegativeNumber([
    raw.actual_cost,
    raw.actualCost,
    raw.total_actual_cost,
    raw.totalActualCost,
    raw.user_cost,
    raw.userCost,
    raw.total_user_cost,
    raw.totalUserCost,
    raw.cost,
    raw.total_cost,
    raw.totalCost,
    raw.used_usd,
    raw.usedUsd,
    raw.usd_cost,
    raw.usdCost,
    billing?.actual_cost,
    billing?.actualCost,
    billing?.user_cost,
    billing?.userCost,
    billing?.cost,
    billing?.total_cost,
    billing?.totalCost,
    billing?.used_usd,
    billing?.usedUsd,
    metrics?.actual_cost,
    metrics?.actualCost,
    metrics?.cost,
    metrics?.total_cost,
    metrics?.totalCost,
    metrics?.used_usd,
    metrics?.usedUsd,
    usage?.actual_cost,
    usage?.actualCost,
    usage?.cost,
    usage?.total_cost,
    usage?.totalCost,
    usage?.used_usd,
    usage?.usedUsd
  ]);
}

function accumulateCLIProxyUsageCost(
  target: Map<string, CLIProxyUsageCostEstimate>,
  authIndex: string,
  modelName: string,
  detail: CLIProxyUsageDetail
): void {
  const tokens = detail.tokens;
  const inputTokens = numberFromUnknown(tokens?.input_tokens);
  const outputTokens = numberFromUnknown(tokens?.output_tokens);
  const cacheReadTokens = numberFromUnknown(tokens?.cache_read_tokens ?? tokens?.cached_tokens);
  const cacheCreationTokens = numberFromUnknown(tokens?.cache_creation_tokens);
  const totalTokensRaw = numberFromUnknown(tokens?.total_tokens);
  const totalTokens =
    totalTokensRaw > 0
      ? totalTokensRaw
      : inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

  const directCost = extractCLIProxyDetailUsedUsd(detail);
  const estimatedCostByTokens =
    estimateTokenUsageCostUsd({
      model: modelName,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens
    }) ?? 0;
  const resolvedCost = typeof directCost === "number" ? directCost : estimatedCostByTokens;

  const aggregate = target.get(authIndex) ?? createEmptyCLIProxyUsageCostEstimate();
  aggregate.estimated_used_usd += resolvedCost;
  aggregate.total_tokens += totalTokens;
  aggregate.input_tokens += inputTokens;
  aggregate.output_tokens += outputTokens;
  aggregate.cache_read_tokens += cacheReadTokens;
  aggregate.cache_creation_tokens += cacheCreationTokens;
  aggregate.requests += 1;
  target.set(authIndex, aggregate);
}

function buildCLIProxyUsageCostByAuthIndex(
  usage: CLIProxyUsageSnapshot | undefined
): Map<string, CLIProxyUsageCostEstimate> {
  const result = new Map<string, CLIProxyUsageCostEstimate>();
  const undatedFallback = new Map<string, CLIProxyUsageCostEstimate>();
  const recentDateKeys = new Set(buildDateKeys(CPA_USAGE_COST_WINDOW_DAYS));
  const apiSnapshots = usage?.apis ?? {};
  for (const apiSnapshot of Object.values(apiSnapshots)) {
    const modelSnapshots = apiSnapshot?.models ?? {};
    for (const [modelName, modelSnapshot] of Object.entries(modelSnapshots)) {
      const details = Array.isArray(modelSnapshot?.details)
        ? modelSnapshot.details
        : [];
      for (const detail of details) {
        const authIndex =
          typeof detail.auth_index === "string" ? detail.auth_index.trim() : "";
        if (!authIndex) {
          continue;
        }
        const dateKey = toUsageDateKey(detail.timestamp);
        if (dateKey) {
          if (!recentDateKeys.has(dateKey)) {
            continue;
          }
          accumulateCLIProxyUsageCost(result, authIndex, modelName, detail);
          continue;
        }
        accumulateCLIProxyUsageCost(undatedFallback, authIndex, modelName, detail);
      }
    }
  }

  for (const [authIndex, fallbackValue] of undatedFallback.entries()) {
    if (!result.has(authIndex)) {
      result.set(authIndex, fallbackValue);
    }
  }

  return result;
}

async function fetchCLIProxyUsageCostByAuthIndex(
  platform: PlatformConfig
): Promise<Map<string, CLIProxyUsageCostEstimate>> {
  const baseUrl = ensurePlatformReady(platform);
  const data = await requestWithFallback<CLIProxyUsageResponse>({
    method: "GET",
    url: `${baseUrl}/v0/management/usage`,
    headers: getCLIProxyHeaders(platform)
  });
  return buildCLIProxyUsageCostByAuthIndex(data.usage);
}

function extractCLIProxyAccountStats(
  usage: CLIProxyUsageSnapshot | undefined,
  account: UnifiedAccount
): Record<string, unknown> {
  const resultByDay = new Map<string, { requests: number; tokens: number }>();
  let totalRequests = 0;
  let totalTokens = 0;
  let failedRequests = 0;

  const raw = (account.raw ?? {}) as Record<string, unknown>;
  const accountAuthIndex =
    typeof raw.auth_index === "string" ? raw.auth_index.trim() : "";
  const accountEmail = (account.email ?? "").trim().toLowerCase();

  const apiSnapshots = usage?.apis ?? {};
  for (const apiSnapshot of Object.values(apiSnapshots)) {
    const modelSnapshots = apiSnapshot?.models ?? {};
    for (const modelSnapshot of Object.values(modelSnapshots)) {
      const details = Array.isArray(modelSnapshot?.details)
        ? modelSnapshot.details
        : [];
      for (const detail of details) {
        const detailAuthIndex =
          typeof detail.auth_index === "string" ? detail.auth_index.trim() : "";
        const detailSource =
          typeof detail.source === "string" ? detail.source.trim().toLowerCase() : "";
        const matchedByAuthIndex =
          accountAuthIndex.length > 0 && detailAuthIndex === accountAuthIndex;
        const matchedBySource =
          accountEmail.length > 0 && detailSource.length > 0 && detailSource === accountEmail;
        if (!matchedByAuthIndex && !matchedBySource) {
          continue;
        }

        totalRequests += 1;
        if (detail.failed) {
          failedRequests += 1;
        }
        const tokenTotal = numberFromUnknown(detail.tokens?.total_tokens);
        totalTokens += tokenTotal;

        const timestamp =
          typeof detail.timestamp === "string" ? detail.timestamp.slice(0, 10) : "";
        if (!isDateKey(timestamp)) {
          continue;
        }
        const dayStats = resultByDay.get(timestamp) ?? { requests: 0, tokens: 0 };
        dayStats.requests += 1;
        dayStats.tokens += tokenTotal;
        resultByDay.set(timestamp, dayStats);
      }
    }
  }

  const sortedDays = Array.from(resultByDay.keys()).sort();
  const requestsByDay: Record<string, number> = {};
  const tokensByDay: Record<string, number> = {};
  for (const day of sortedDays) {
    const dayStats = resultByDay.get(day);
    if (!dayStats) {
      continue;
    }
    requestsByDay[day] = dayStats.requests;
    tokensByDay[day] = dayStats.tokens;
  }

  return {
    total_requests: totalRequests,
    total_tokens: totalTokens,
    failed_requests: failedRequests,
    requests_by_day: requestsByDay,
    tokens_by_day: tokensByDay
  };
}

export function sanitizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

async function fetchCLIProxyAccounts(
  platform: PlatformConfig
): Promise<UnifiedAccount[]> {
  const baseUrl = ensurePlatformReady(platform);
  const data = await requestWithFallback<CLIProxyListResponse>({
    method: "GET",
    url: `${baseUrl}/v0/management/auth-files`,
    headers: getCLIProxyHeaders(platform)
  });
  const files = Array.isArray(data.files) ? data.files : [];
  const [quotaByAuthIndex, usageCostByAuthIndex] = await Promise.all([
    buildCLIProxyQuotaByAuthIndex(platform, files),
    fetchCLIProxyUsageCostByAuthIndex(platform).catch(
      () => new Map<string, CLIProxyUsageCostEstimate>()
    )
  ]);

  return files.map((item, index) => {
    const authIndex = pickFirstString(item.auth_index);
    const quotaUsage = authIndex ? quotaByAuthIndex.get(authIndex) : undefined;
    const usageCostEstimate = authIndex
      ? usageCostByAuthIndex.get(authIndex)
      : undefined;
    return mapCLIProxyFileToUnified(
      platform,
      item,
      index,
      quotaUsage,
      usageCostEstimate
    );
  });
}

async function fetchSub2ApiAccountStats(
  platform: PlatformConfig,
  accountId: number
): Promise<Record<string, unknown> | undefined> {
  const cached = readSub2AccountStatsCache(platform, accountId);
  if (cached) {
    return cached;
  }

  const baseUrl = ensurePlatformReady(platform);
  const envelope = await requestWithFallback<Sub2ApiEnvelope<Record<string, unknown>>>({
    method: "GET",
    url: `${baseUrl}/api/v1/admin/accounts/${accountId}/stats`,
    params: {
      days: 30
    },
    headers: getSub2ApiHeaders(platform),
    timeout: 12000
  });

  const payload = unwrapSub2Api<Record<string, unknown>>(
    envelope,
    `Failed to fetch sub2api stats for account ${accountId}.`
  );
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    writeSub2AccountStatsCache(platform, accountId, payload);
    return payload;
  }
  return undefined;
}

async function fetchSub2ApiAccountUsageWindow(
  platform: PlatformConfig,
  accountId: number
): Promise<Record<string, unknown> | undefined> {
  const cached = readSub2AccountUsageWindowCache(platform, accountId);
  if (cached) {
    return cached;
  }

  const baseUrl = ensurePlatformReady(platform);
  const sources = ["passive", "active"] as const;

  for (const source of sources) {
    try {
      const envelope = await requestWithFallback<Sub2ApiEnvelope<Record<string, unknown>>>({
        method: "GET",
        url: `${baseUrl}/api/v1/admin/accounts/${accountId}/usage`,
        params: { source },
        headers: getSub2ApiHeaders(platform),
        timeout: 10000
      });
      const payload = unwrapSub2Api<Record<string, unknown>>(
        envelope,
        `Failed to fetch sub2api usage window for account ${accountId}.`
      );
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        writeSub2AccountUsageWindowCache(platform, accountId, payload);
        return payload;
      }
    } catch {
      // fall through and try next source
    }
  }

  return undefined;
}

async function buildSub2ApiStatsByAccountId(
  platform: PlatformConfig,
  items: Sub2ApiAccount[]
): Promise<Map<string, Record<string, unknown>>> {
  const jobs: Array<{
    accountId: string;
    task: () => Promise<Record<string, unknown> | undefined>;
  }> = [];

  for (const item of items) {
    const accountIdText = pickFirstString(item.id as string | number | undefined);
    if (!accountIdText) {
      continue;
    }
    const accountId = Number.parseInt(accountIdText, 10);
    if (!Number.isFinite(accountId)) {
      continue;
    }
    jobs.push({
      accountId: accountIdText,
      task: () => fetchSub2ApiAccountStats(platform, accountId)
    });
  }

  const resultMap = new Map<string, Record<string, unknown>>();
  if (!jobs.length) {
    return resultMap;
  }

  const results = await runWithConcurrency(
    jobs.map(({ task }) => async () => {
      try {
        return await task();
      } catch {
        return undefined;
      }
    }),
    6
  );

  for (let i = 0; i < jobs.length; i += 1) {
    const payload = results[i];
    if (payload && Object.keys(payload).length > 0) {
      resultMap.set(jobs[i].accountId, payload);
    }
  }
  return resultMap;
}

async function buildSub2ApiUsageWindowByAccountId(
  platform: PlatformConfig,
  items: Sub2ApiAccount[]
): Promise<Map<string, Record<string, unknown>>> {
  const jobs: Array<{
    accountId: string;
    task: () => Promise<Record<string, unknown> | undefined>;
  }> = [];

  for (const item of items) {
    const accountIdText = pickFirstString(item.id as string | number | undefined);
    if (!accountIdText) {
      continue;
    }
    const accountId = Number.parseInt(accountIdText, 10);
    if (!Number.isFinite(accountId)) {
      continue;
    }
    jobs.push({
      accountId: accountIdText,
      task: () => fetchSub2ApiAccountUsageWindow(platform, accountId)
    });
  }

  const resultMap = new Map<string, Record<string, unknown>>();
  if (!jobs.length) {
    return resultMap;
  }

  const results = await runWithConcurrency(
    jobs.map(({ task }) => async () => {
      try {
        return await task();
      } catch {
        return undefined;
      }
    }),
    6
  );

  for (let i = 0; i < jobs.length; i += 1) {
    const payload = results[i];
    if (payload && Object.keys(payload).length > 0) {
      resultMap.set(jobs[i].accountId, payload);
    }
  }
  return resultMap;
}

async function fetchSub2ApiAccounts(
  platform: PlatformConfig
): Promise<UnifiedAccount[]> {
  const baseUrl = ensurePlatformReady(platform);
  const data = await requestWithFallback<Sub2ApiEnvelope<Sub2ApiPaginated<Sub2ApiAccount>>>(
    {
      method: "GET",
      url: `${baseUrl}/api/v1/admin/accounts`,
      params: {
        page: 1,
        page_size: 300
      },
      headers: getSub2ApiHeaders(platform)
    }
  );

  const pageData = unwrapSub2Api<Sub2ApiPaginated<Sub2ApiAccount>>(
    data,
    "Failed to fetch sub2api accounts."
  );
  const items = Array.isArray(pageData?.items) ? pageData.items : [];
  const [usageStatsByAccountId, usageWindowByAccountId] = await Promise.all([
    buildSub2ApiStatsByAccountId(platform, items).catch(
      () => new Map<string, Record<string, unknown>>()
    ),
    buildSub2ApiUsageWindowByAccountId(platform, items).catch(
      () => new Map<string, Record<string, unknown>>()
    )
  ]);

  return items.map((item, index) => {
    const accountId = pickFirstString(item.id as string | number | undefined) ?? "";
    const usageStats = accountId ? usageStatsByAccountId.get(accountId) : undefined;
    const usageWindow = accountId ? usageWindowByAccountId.get(accountId) : undefined;
    return mapSub2ApiAccountToUnified(platform, item, index, usageStats, usageWindow);
  });
}

async function fetchCLIProxyTrend(
  platform: PlatformConfig
): Promise<Record<string, number>> {
  const baseUrl = ensurePlatformReady(platform);
  const data = await requestWithFallback<CLIProxyUsageResponse>({
    method: "GET",
    url: `${baseUrl}/v0/management/usage`,
    headers: getCLIProxyHeaders(platform)
  });
  const tokensByDay = data.usage?.tokens_by_day ?? {};
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(tokensByDay)) {
    if (!isDateKey(key)) {
      continue;
    }
    result[key] = numberFromUnknown(value);
  }
  return result;
}

async function fetchSub2ApiTrend(
  platform: PlatformConfig,
  days: number
): Promise<Record<string, number>> {
  const baseUrl = ensurePlatformReady(platform);
  const dateKeys = buildDateKeys(days);
  const startDate = dateKeys[0];
  const endDate = dateKeys[dateKeys.length - 1];
  const envelope = await requestWithFallback<
    Sub2ApiEnvelope<Sub2ApiDashboardTrendPayload>
  >({
    method: "GET",
    url: `${baseUrl}/api/v1/admin/dashboard/trend`,
    params: {
      start_date: startDate,
      end_date: endDate,
      granularity: "day"
    },
    headers: getSub2ApiHeaders(platform)
  });
  const payload = unwrapSub2Api(
    envelope,
    "Failed to load sub2api dashboard trend."
  );
  const trendList = Array.isArray(payload?.trend) ? payload.trend : [];
  const result: Record<string, number> = {};
  for (const item of trendList) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const dateKey = typeof item.date === "string" ? item.date.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      continue;
    }
    result[dateKey] = numberFromUnknown(item.total_tokens ?? item.tokens);
  }
  return result;
}

export async function fetchPlatformUsageTrend(
  platforms: PlatformConfig[],
  days = 14
): Promise<TrendFetchResult> {
  const normalizedDays = Math.max(3, Math.min(30, Math.trunc(days)));
  const dateKeys = buildDateKeys(normalizedDays);
  const sub2apiValues = new Array<number>(dateKeys.length).fill(0);
  const cpaValues = new Array<number>(dateKeys.length).fill(0);
  const errors: string[] = [];

  const tasks: Array<Promise<void>> = [];
  for (const platform of platforms) {
    if (!platform.enabled) {
      continue;
    }
    if (platform.id === "cliproxyapi") {
      tasks.push(
        fetchCLIProxyTrend(platform)
          .then((trendMap) => {
            for (let i = 0; i < dateKeys.length; i += 1) {
              cpaValues[i] = numberFromUnknown(trendMap[dateKeys[i]]);
            }
          })
          .catch((error) => {
            errors.push(`${platform.name} 瓒嬪娍鑾峰彇澶辫触锛?{parseError(error)}`);
          })
      );
      continue;
    }
    tasks.push(
      fetchSub2ApiTrend(platform, normalizedDays)
        .then((trendMap) => {
          for (let i = 0; i < dateKeys.length; i += 1) {
            sub2apiValues[i] = numberFromUnknown(trendMap[dateKeys[i]]);
          }
        })
        .catch((error) => {
          errors.push(`${platform.name} 瓒嬪娍鑾峰彇澶辫触锛?{parseError(error)}`);
        })
    );
  }

  await Promise.all(tasks);

  return {
    trend: {
      labels: dateKeys.map((key) => dateLabelFromKey(key)),
      sub2apiValues,
      cpaValues
    },
    errors
  };
}

export async function fetchAccountsForPlatform(
  platform: PlatformConfig
): Promise<PlatformFetchResult> {
  try {
    const accounts =
      platform.id === "cliproxyapi"
        ? await fetchCLIProxyAccounts(platform)
        : await fetchSub2ApiAccounts(platform);

    return {
      platform,
      accounts
    };
  } catch (error) {
    return {
      platform,
      accounts: [],
      error: `${platform.name}: ${parseError(error)}`
    };
  }
}

export async function fetchUnifiedAccounts(
  platforms: PlatformConfig[]
): Promise<{ accounts: UnifiedAccount[]; errors: string[] }> {
  const enabledPlatforms = platforms.filter((item) => item.enabled);
  if (!enabledPlatforms.length) {
    return {
      accounts: [],
      errors: ["No platform is enabled."]
    };
  }

  const results = await Promise.all(
    enabledPlatforms.map((platform) => fetchAccountsForPlatform(platform))
  );

  const accounts = results
    .flatMap((result) => result.accounts)
    .sort(
      (a, b) =>
        a.platformName.localeCompare(b.platformName) ||
        a.name.localeCompare(b.name)
    );

  const errors = results
    .filter((result) => typeof result.error === "string")
    .map((result) => result.error as string);

  return {
    accounts,
    errors
  };
}

export async function fetchAccountDetail(
  platform: PlatformConfig,
  account: UnifiedAccount
): Promise<AccountDetailResult> {
  if (account.platform === "cliproxyapi") {
    const baseUrl = ensurePlatformReady(platform);
    const [modelsData, usageData] = await Promise.all([
      requestWithFallback<CLIProxyModelsResponse>({
        method: "GET",
        url: `${baseUrl}/v0/management/auth-files/models`,
        params: {
          name: account.manageKey
        },
        headers: getCLIProxyHeaders(platform)
      }),
      requestWithFallback<CLIProxyUsageResponse>({
        method: "GET",
        url: `${baseUrl}/v0/management/usage`,
        headers: getCLIProxyHeaders(platform)
      })
    ]);

    return {
      account,
      profile: account.raw,
      stats: extractCLIProxyAccountStats(usageData.usage, account),
      models: modelsData.models ?? [],
      refreshedAt: new Date().toISOString()
    };
  }

  const baseUrl = ensurePlatformReady(platform);
  const accountId = ensureNumericAccountId(account);

  const [profileResponse, statsResponse] = await Promise.all([
    requestWithFallback<Sub2ApiEnvelope<Record<string, unknown>>>({
      method: "GET",
      url: `${baseUrl}/api/v1/admin/accounts/${accountId}`,
      headers: getSub2ApiHeaders(platform)
    }),
    requestWithFallback<Sub2ApiEnvelope<Record<string, unknown>>>({
      method: "GET",
      url: `${baseUrl}/api/v1/admin/accounts/${accountId}/stats`,
      params: {
        days: 30
      },
      headers: getSub2ApiHeaders(platform)
    })
  ]);

  return {
    account,
    profile: unwrapSub2Api(profileResponse, "Failed to load account detail."),
    stats: unwrapSub2Api(statsResponse, "Failed to load account stats."),
    refreshedAt: new Date().toISOString()
  };
}

export async function setAccountEnabled(
  platform: PlatformConfig,
  account: UnifiedAccount,
  enabled: boolean
): Promise<void> {
  const baseUrl = ensurePlatformReady(platform);
  if (account.platform === "cliproxyapi") {
    await requestWithFallback({
      method: "PATCH",
      url: `${baseUrl}/v0/management/auth-files/status`,
      data: {
        name: account.manageKey,
        disabled: !enabled
      },
      headers: getCLIProxyHeaders(platform)
    });
    return;
  }

  const accountId = ensureNumericAccountId(account);
  await requestWithFallback({
    method: "POST",
    url: `${baseUrl}/api/v1/admin/accounts/${accountId}/schedulable`,
    data: {
      schedulable: enabled
    },
    headers: getSub2ApiHeaders(platform)
  });
}

export async function batchSetAccountsEnabled(
  platform: PlatformConfig,
  accounts: UnifiedAccount[],
  enabled: boolean
): Promise<void> {
  if (!accounts.length) {
    return;
  }
  const baseUrl = ensurePlatformReady(platform);
  if (accounts[0].platform === "cliproxyapi") {
    await Promise.all(
      accounts.map((account) =>
        requestWithFallback({
          method: "PATCH",
          url: `${baseUrl}/v0/management/auth-files/status`,
          data: {
            name: account.manageKey,
            disabled: !enabled
          },
          headers: getCLIProxyHeaders(platform)
        })
      )
    );
    return;
  }

  const accountIds = accounts
    .map((item) => Number.parseInt(item.manageKey, 10))
    .filter((item) => Number.isFinite(item));
  if (!accountIds.length) {
    throw new Error("No valid sub2api account ids for batch operation.");
  }
  await requestWithFallback({
    method: "POST",
    url: `${baseUrl}/api/v1/admin/accounts/bulk-update`,
    data: {
      account_ids: accountIds,
      schedulable: enabled
    },
    headers: getSub2ApiHeaders(platform)
  });
}

export async function updateAccountEditableFields(
  platform: PlatformConfig,
  account: UnifiedAccount,
  payload: EditAccountPayload
): Promise<void> {
  const baseUrl = ensurePlatformReady(platform);
  if (account.platform === "cliproxyapi") {
    const body: Record<string, unknown> = {
      name: account.manageKey
    };
    if (typeof payload.priority === "number") {
      body.priority = payload.priority;
    }
    if (typeof payload.note === "string") {
      body.note = payload.note;
    }

    await requestWithFallback({
      method: "PATCH",
      url: `${baseUrl}/v0/management/auth-files/fields`,
      data: body,
      headers: getCLIProxyHeaders(platform)
    });
    return;
  }

  const accountId = ensureNumericAccountId(account);
  const body: Record<string, unknown> = {};
  if (typeof payload.name === "string") {
    body.name = payload.name;
  }
  if (typeof payload.priority === "number") {
    body.priority = payload.priority;
  }
  if (typeof payload.note === "string") {
    body.notes = payload.note;
  }

  await requestWithFallback({
    method: "PUT",
    url: `${baseUrl}/api/v1/admin/accounts/${accountId}`,
    data: body,
    headers: getSub2ApiHeaders(platform)
  });
}

export async function batchUpdateAccountFields(
  platform: PlatformConfig,
  accounts: UnifiedAccount[],
  payload: BatchEditPayload
): Promise<void> {
  if (!accounts.length) {
    return;
  }
  const baseUrl = ensurePlatformReady(platform);
  if (accounts[0].platform === "cliproxyapi") {
    await Promise.all(
      accounts.map((account) => {
        const body: Record<string, unknown> = {
          name: account.manageKey
        };
        if (typeof payload.priority === "number") {
          body.priority = payload.priority;
        }
        if (typeof payload.note === "string") {
          body.note = payload.note;
        }
        return requestWithFallback({
          method: "PATCH",
          url: `${baseUrl}/v0/management/auth-files/fields`,
          data: body,
          headers: getCLIProxyHeaders(platform)
        });
      })
    );
    return;
  }

  const body: Record<string, unknown> = {
    account_ids: accounts
      .map((item) => Number.parseInt(item.manageKey, 10))
      .filter((item) => Number.isFinite(item))
  };
  if (typeof payload.priority === "number") {
    body.priority = payload.priority;
  }
  await requestWithFallback({
    method: "POST",
    url: `${baseUrl}/api/v1/admin/accounts/bulk-update`,
    data: body,
    headers: getSub2ApiHeaders(platform)
  });
}

