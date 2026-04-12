import type { PlatformKind, PlatformQuotaSummary, UnifiedAccount } from "../types/platform";
import { estimateTokenUsageCostUsd } from "./pricing";

interface AccountQuotaSnapshot {
  remainingPercent?: number;
  remainingUsd?: number;
  estimatedRemainingUsd?: number;
  estimatedUsedUsd?: number;
  transferredTokens?: number;
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

function toStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function normalizePercentageLike(value: number): number {
  if (value >= 0 && value <= 1) {
    return value * 100;
  }
  return value;
}

function readPathValue(source: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = source;
  for (const segment of segments) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function pickNumberFromSources(
  sources: Record<string, unknown>[],
  candidatePaths: string[]
): number | undefined {
  for (const path of candidatePaths) {
    for (const source of sources) {
      const value = toOptionalNumber(readPathValue(source, path));
      if (typeof value === "number") {
        return value;
      }
    }
  }
  return undefined;
}

function pickStringFromSources(
  sources: Record<string, unknown>[],
  candidatePaths: string[]
): string | undefined {
  for (const path of candidatePaths) {
    for (const source of sources) {
      const value = toStringValue(readPathValue(source, path));
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function decodeBase64UrlSegment(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    if (typeof atob === "function") {
      return atob(padded);
    }
  } catch {
    return undefined;
  }
  return undefined;
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
    // Continue to JWT payload decode.
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

function resolvePlanType(raw: Record<string, unknown>): string | undefined {
  const extra = toRecord(raw.extra);
  const metadata = toRecord(raw.metadata);
  const attributes = toRecord(raw.attributes);
  const credentials = toRecord(raw.credentials);

  const idTokenCandidates: unknown[] = [
    raw.id_token,
    metadata?.id_token,
    attributes?.id_token,
    credentials?.id_token
  ];

  const tokenPayloads = idTokenCandidates
    .map((candidate) => parseIdTokenPayload(candidate))
    .filter((value): value is Record<string, unknown> => Boolean(value));

  const candidates: unknown[] = [
    raw.plan_type,
    raw.planType,
    extra?.plan_type,
    extra?.planType,
    metadata?.plan_type,
    metadata?.planType,
    attributes?.plan_type,
    attributes?.planType,
    credentials?.plan_type,
    credentials?.planType,
    credentials?.chatgpt_plan_type,
    credentials?.chatgptPlanType,
    ...tokenPayloads.flatMap((payload) => [payload.plan_type, payload.planType]),
    raw.account,
    raw.name,
    raw.id,
    raw.label
  ];

  for (const candidate of candidates) {
    const normalized = toStringValue(candidate)?.toLowerCase();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function isLikelyFreePlan(raw: Record<string, unknown>): boolean {
  const plan = resolvePlanType(raw);
  if (!plan) {
    return false;
  }
  return plan.includes("free");
}

function getWindowSeconds(window: Record<string, unknown> | undefined): number | undefined {
  if (!window) {
    return undefined;
  }
  return toOptionalNumber(window.limit_window_seconds ?? window.limitWindowSeconds);
}

function getWindowUsedPercent(
  window: Record<string, unknown> | undefined,
  limitInfo: Record<string, unknown> | undefined
): number | undefined {
  const direct = toOptionalNumber(window?.used_percent ?? window?.usedPercent);
  if (typeof direct === "number") {
    return normalizePercent(normalizePercentageLike(direct));
  }
  const limitReached = limitInfo?.limit_reached ?? limitInfo?.limitReached;
  const allowed = limitInfo?.allowed;
  if (limitReached === true || allowed === false) {
    return 100;
  }
  return undefined;
}

function pickClassifiedWindows(
  limitInfo: Record<string, unknown> | undefined
): {
  fiveHourWindow?: Record<string, unknown>;
  weeklyWindow?: Record<string, unknown>;
} {
  const FIVE_HOUR_SECONDS = 18_000;
  const WEEK_SECONDS = 604_800;
  const primaryWindow = toRecord(limitInfo?.primary_window ?? limitInfo?.primaryWindow);
  const secondaryWindow = toRecord(
    limitInfo?.secondary_window ?? limitInfo?.secondaryWindow
  );
  const windows = [primaryWindow, secondaryWindow];

  let fiveHourWindow: Record<string, unknown> | undefined;
  let weeklyWindow: Record<string, unknown> | undefined;

  for (const window of windows) {
    if (!window) {
      continue;
    }
    const seconds = getWindowSeconds(window);
    if (seconds === FIVE_HOUR_SECONDS && !fiveHourWindow) {
      fiveHourWindow = window;
      continue;
    }
    if (seconds === WEEK_SECONDS && !weeklyWindow) {
      weeklyWindow = window;
    }
  }

  if (!fiveHourWindow && primaryWindow && primaryWindow !== weeklyWindow) {
    fiveHourWindow = primaryWindow;
  }
  if (!weeklyWindow && secondaryWindow && secondaryWindow !== fiveHourWindow) {
    weeklyWindow = secondaryWindow;
  }

  return { fiveHourWindow, weeklyWindow };
}

function extractCpaRemainingPercent(raw: Record<string, unknown>): number | undefined {
  const usagePayload = toRecord(raw.cpa_quota_usage);
  if (usagePayload) {
    const rateLimit = toRecord(usagePayload.rate_limit ?? usagePayload.rateLimit);
    const weeklyWindow = pickClassifiedWindows(rateLimit).weeklyWindow;
    const weeklyUsed = getWindowUsedPercent(weeklyWindow, rateLimit);
    if (typeof weeklyUsed === "number") {
      return normalizePercent(100 - weeklyUsed);
    }
  }

  const sources: Record<string, unknown>[] = [raw];
  if (usagePayload) {
    sources.push(usagePayload);
  }
  if (raw.extra && typeof raw.extra === "object") {
    sources.push(raw.extra as Record<string, unknown>);
  }

  const weeklyRemainingDirect = pickNumberFromSources(sources, [
    "codex_weekly_remaining_percent",
    "weekly_remaining_percent",
    "week_remaining_percent",
    "remaining_percent_weekly",
    "quota_weekly_remaining_percent",
    "weekly_quota_remaining_percent",
    "weekly_remaining",
    "week_remaining"
  ]);
  if (typeof weeklyRemainingDirect === "number") {
    return normalizePercent(normalizePercentageLike(weeklyRemainingDirect));
  }

  const weeklyUsed = pickNumberFromSources(sources, [
    "codex_weekly_used_percent",
    "weekly_used_percent",
    "week_used_percent",
    "used_percent_weekly",
    "quota_weekly_used_percent"
  ]);
  if (typeof weeklyUsed === "number") {
    return normalizePercent(100 - normalizePercentageLike(weeklyUsed));
  }
  return undefined;
}

function extractSub2RemainingPercent(raw: Record<string, unknown>): number | undefined {
  const extra = toRecord(raw.extra);
  if (extra) {
    const weeklyUsedRaw = toOptionalNumber(extra.codex_7d_used_percent);
    if (typeof weeklyUsedRaw === "number") {
      return normalizePercent(100 - normalizePercentageLike(weeklyUsedRaw));
    }

    const fiveHourRaw = toOptionalNumber(extra.codex_5h_used_percent);
    if (!isLikelyFreePlan(raw) && typeof fiveHourRaw === "number") {
      return normalizePercent(100 - normalizePercentageLike(fiveHourRaw));
    }
  }

  const weeklyLimit = toOptionalNumber(raw.quota_weekly_limit);
  const weeklyUsed = toOptionalNumber(raw.quota_weekly_used);
  if (typeof weeklyLimit === "number" && weeklyLimit > 0) {
    return normalizePercent(100 - (normalizePercent((weeklyUsed ?? 0) / weeklyLimit * 100)));
  }

  const totalLimit = toOptionalNumber(raw.quota_limit);
  const totalUsed = toOptionalNumber(raw.quota_used);
  if (typeof totalLimit === "number" && totalLimit > 0) {
    return normalizePercent(100 - (normalizePercent((totalUsed ?? 0) / totalLimit * 100)));
  }

  const dailyLimit = toOptionalNumber(raw.quota_daily_limit);
  const dailyUsed = toOptionalNumber(raw.quota_daily_used);
  if (typeof dailyLimit === "number" && dailyLimit > 0) {
    return normalizePercent(100 - (normalizePercent((dailyUsed ?? 0) / dailyLimit * 100)));
  }

  return undefined;
}

function extractRemainingUsd(raw: Record<string, unknown>): number | undefined {
  const sources: Record<string, unknown>[] = [raw];
  const extra = toRecord(raw.extra);
  const usagePayload = toRecord(raw.cpa_quota_usage);
  const usageCostEstimate = toRecord(raw.cpa_usage_cost_estimate);
  const sub2UsageStats = toRecord(raw.sub2_usage_stats);
  if (extra) {
    sources.push(extra);
  }
  if (usagePayload) {
    sources.push(usagePayload);
  }
  if (usageCostEstimate) {
    sources.push(usageCostEstimate);
  }
  if (sub2UsageStats) {
    sources.push(sub2UsageStats);
  }

  const value = pickNumberFromSources(sources, [
    "quota_remaining_usd",
    "remaining_usd",
    "remaining_dollars",
    "balance_usd",
    "credit_balance_usd",
    "remaining_balance_usd",
    "quota.remaining_usd",
    "billing.remaining_usd"
  ]);
  if (typeof value === "number" && value >= 0) {
    return value;
  }

  const quotaLimit = pickNumberFromSources(sources, [
    "quota_limit",
    "quota.limit",
    "billing.quota_limit",
    "billing.limit_usd"
  ]);
  const quotaUsed = pickNumberFromSources(sources, [
    "quota_used",
    "quota.used",
    "billing.used_usd",
    "used_usd"
  ]);
  if (
    typeof quotaLimit === "number" &&
    quotaLimit > 0 &&
    typeof quotaUsed === "number" &&
    quotaUsed >= 0
  ) {
    return Math.max(0, quotaLimit - quotaUsed);
  }

  return undefined;
}

function extractEstimatedUsedUsd(raw: Record<string, unknown>): number | undefined {
  const sources: Record<string, unknown>[] = [raw];
  const extra = toRecord(raw.extra);
  const usagePayload = toRecord(raw.cpa_quota_usage);
  const usageCostEstimate = toRecord(raw.cpa_usage_cost_estimate);
  const sub2UsageStats = toRecord(raw.sub2_usage_stats);
  if (extra) {
    sources.push(extra);
  }
  if (usagePayload) {
    sources.push(usagePayload);
  }
  if (usageCostEstimate) {
    sources.push(usageCostEstimate);
  }
  if (sub2UsageStats) {
    sources.push(sub2UsageStats);
  }

  const direct = pickNumberFromSources(sources, [
    "actual_cost",
    "total_actual_cost",
    "total_cost",
    "cost",
    "summary.actual_cost",
    "summary.total_actual_cost",
    "summary.total_cost",
    "summary.total_user_cost",
    "stats.summary.actual_cost",
    "stats.summary.total_actual_cost",
    "stats.summary.total_cost",
    "stats.summary.total_user_cost",
    "sub2_usage_stats.summary.actual_cost",
    "sub2_usage_stats.summary.total_actual_cost",
    "sub2_usage_stats.summary.total_cost",
    "sub2_usage_stats.summary.total_user_cost",
    "cpa_usage_cost_estimate.estimated_used_usd",
    "usage_cost.estimated_used_usd",
    "estimated_used_usd"
  ]);
  if (typeof direct === "number" && direct >= 0) {
    return direct;
  }

  const model = pickStringFromSources(sources, [
    "model",
    "model_name",
    "usage_model",
    "usage.model"
  ]);
  const estimatedByTokens = estimateTokenUsageCostUsd({
    model,
    inputTokens: pickNumberFromSources(sources, [
      "input_tokens",
      "total_input_tokens",
      "usage.input_tokens",
      "stats.input_tokens"
    ]),
    outputTokens: pickNumberFromSources(sources, [
      "output_tokens",
      "total_output_tokens",
      "usage.output_tokens",
      "stats.output_tokens"
    ]),
    cacheReadTokens: pickNumberFromSources(sources, [
      "cache_read_tokens",
      "cached_tokens",
      "usage.cache_read_tokens",
      "usage.cached_tokens",
      "stats.cache_read_tokens"
    ]),
    cacheCreationTokens: pickNumberFromSources(sources, [
      "cache_creation_tokens",
      "usage.cache_creation_tokens",
      "stats.cache_creation_tokens"
    ])
  });
  if (typeof estimatedByTokens === "number" && estimatedByTokens >= 0) {
    return estimatedByTokens;
  }

  const modelCollections: unknown[] = [raw.models, sub2UsageStats?.models];
  for (const models of modelCollections) {
    if (!Array.isArray(models)) {
      continue;
    }
    let total = 0;
    let hasValue = false;
    for (const modelEntry of models) {
      if (!modelEntry || typeof modelEntry !== "object") {
        continue;
      }
      const item = modelEntry as Record<string, unknown>;
      const modelCost = toOptionalNumber(
        item.actual_cost ?? item.total_actual_cost ?? item.total_cost ?? item.cost
      );
      if (typeof modelCost === "number" && modelCost >= 0) {
        total += modelCost;
        hasValue = true;
        continue;
      }
      const estimated = estimateTokenUsageCostUsd({
        model: toStringValue(item.model ?? item.model_name),
        inputTokens: toOptionalNumber(item.input_tokens),
        outputTokens: toOptionalNumber(item.output_tokens),
        cacheReadTokens: toOptionalNumber(
          item.cache_read_tokens ?? item.cached_tokens
        ),
        cacheCreationTokens: toOptionalNumber(item.cache_creation_tokens)
      });
      if (typeof estimated === "number" && estimated >= 0) {
        total += estimated;
        hasValue = true;
      }
    }
    if (hasValue) {
      return total;
    }
  }

  return undefined;
}

function extractTransferredTokens(raw: Record<string, unknown>): number | undefined {
  const sources: Record<string, unknown>[] = [raw];
  const extra = toRecord(raw.extra);
  const usagePayload = toRecord(raw.cpa_quota_usage);
  const usageCostEstimate = toRecord(raw.cpa_usage_cost_estimate);
  const sub2UsageStats = toRecord(raw.sub2_usage_stats);
  if (extra) {
    sources.push(extra);
  }
  if (usagePayload) {
    sources.push(usagePayload);
  }
  if (usageCostEstimate) {
    sources.push(usageCostEstimate);
  }
  if (sub2UsageStats) {
    sources.push(sub2UsageStats);
  }

  const direct = pickNumberFromSources(sources, [
    "cpa_usage_cost_estimate.total_tokens",
    "sub2_usage_stats.summary.total_tokens",
    "summary.total_tokens",
    "stats.summary.total_tokens",
    "usage.total_tokens",
    "tokens.total_tokens",
    "total_tokens"
  ]);
  if (typeof direct === "number" && direct >= 0) {
    return direct;
  }

  const history = sub2UsageStats?.history;
  if (Array.isArray(history)) {
    let total = 0;
    let hasValue = false;
    for (const entry of history) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const tokens = toOptionalNumber((entry as Record<string, unknown>).tokens);
      if (typeof tokens === "number" && tokens >= 0) {
        total += tokens;
        hasValue = true;
      }
    }
    if (hasValue) {
      return total;
    }
  }

  const modelCollections: unknown[] = [raw.models, sub2UsageStats?.models];
  for (const models of modelCollections) {
    if (!Array.isArray(models)) {
      continue;
    }
    let total = 0;
    let hasValue = false;
    for (const modelEntry of models) {
      if (!modelEntry || typeof modelEntry !== "object") {
        continue;
      }
      const modelTokens = toOptionalNumber(
        (modelEntry as Record<string, unknown>).total_tokens
      );
      if (typeof modelTokens === "number" && modelTokens >= 0) {
        total += modelTokens;
        hasValue = true;
      }
    }
    if (hasValue) {
      return total;
    }
  }

  return undefined;
}

function inferEstimatedRemainingUsd(options: {
  remainingUsd?: number;
  remainingPercent?: number;
  estimatedUsedUsd?: number;
}): number | undefined {
  const { remainingUsd, remainingPercent, estimatedUsedUsd } = options;

  if (typeof remainingUsd === "number" && remainingUsd >= 0) {
    return remainingUsd;
  }
  if (typeof estimatedUsedUsd !== "number" || estimatedUsedUsd < 0) {
    return undefined;
  }
  if (typeof remainingPercent !== "number") {
    return undefined;
  }

  const normalizedRemaining = normalizePercent(remainingPercent);
  const usedPercent = normalizePercent(100 - normalizedRemaining);
  if (usedPercent >= 100) {
    return 0;
  }
  if (usedPercent <= 0) {
    return undefined;
  }

  const estimatedTotal = estimatedUsedUsd / (usedPercent / 100);
  if (!Number.isFinite(estimatedTotal) || estimatedTotal < estimatedUsedUsd) {
    return undefined;
  }

  return Math.max(0, estimatedTotal - estimatedUsedUsd);
}

function extractAccountQuotaSnapshot(account: UnifiedAccount): AccountQuotaSnapshot {
  const raw = toRecord(account.raw);
  if (!raw) {
    return {};
  }

  const remainingPercent =
    account.platform === "cliproxyapi"
      ? extractCpaRemainingPercent(raw)
      : extractSub2RemainingPercent(raw);
  const remainingUsd = extractRemainingUsd(raw);
  const estimatedUsedUsd = extractEstimatedUsedUsd(raw);
  const estimatedRemainingUsd = inferEstimatedRemainingUsd({
    remainingUsd,
    remainingPercent,
    estimatedUsedUsd
  });
  const transferredTokens = extractTransferredTokens(raw);

  return {
    remainingPercent:
      typeof remainingPercent === "number" ? normalizePercent(remainingPercent) : undefined,
    remainingUsd,
    estimatedRemainingUsd,
    estimatedUsedUsd,
    transferredTokens
  };
}

export function buildPlatformQuotaSummary(
  accounts: UnifiedAccount[],
  platform: PlatformKind
): PlatformQuotaSummary {
  const scoped = accounts.filter((item) => item.platform === platform);
  const snapshots = scoped.map(extractAccountQuotaSnapshot);
  const percentValues = snapshots
    .map((item) => item.remainingPercent)
    .filter((value): value is number => typeof value === "number");
  const usdValues = snapshots
    .map((item) => item.remainingUsd)
    .filter((value): value is number => typeof value === "number");
  const estimatedRemainingUsdValues = snapshots
    .map((item) => item.estimatedRemainingUsd)
    .filter((value): value is number => typeof value === "number");
  const estimatedUsedUsdValues = snapshots
    .map((item) => item.estimatedUsedUsd)
    .filter((value): value is number => typeof value === "number");
  const transferredTokenValues = snapshots
    .map((item) => item.transferredTokens)
    .filter((value): value is number => typeof value === "number");

  const averageRemainingPercent =
    percentValues.length > 0
      ? percentValues.reduce((sum, value) => sum + value, 0) / percentValues.length
      : undefined;
  const totalRemainingUsd =
    usdValues.length > 0
      ? usdValues.reduce((sum, value) => sum + value, 0)
      : undefined;
  const totalEstimatedRemainingUsd =
    estimatedRemainingUsdValues.length > 0
      ? estimatedRemainingUsdValues.reduce((sum, value) => sum + value, 0)
      : undefined;
  const totalEstimatedUsedUsd =
    estimatedUsedUsdValues.length > 0
      ? estimatedUsedUsdValues.reduce((sum, value) => sum + value, 0)
      : undefined;
  const totalTransferredTokens =
    transferredTokenValues.length > 0
      ? transferredTokenValues.reduce((sum, value) => sum + value, 0)
      : undefined;

  return {
    platform,
    label: platform === "cliproxyapi" ? "cpa" : "sub2api",
    accountCount: scoped.length,
    measurableCount: percentValues.length,
    averageRemainingPercent,
    totalRemainingUsd,
    totalEstimatedRemainingUsd,
    totalEstimatedUsedUsd,
    totalTransferredTokens
  };
}
