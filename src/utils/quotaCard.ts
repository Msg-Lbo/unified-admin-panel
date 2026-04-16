import type { UnifiedAccount } from "../types/platform";

export interface QuotaCardMetrics {
  totalText: string;
  usedText: string;
  totalValue?: number;
  usedValue?: number;
  usedUsdValue?: number;
  totalUsdValue?: number;
  usdQuotaValue?: number;
  remainingPercent?: number;
  usedPercent?: number;
  exhausted: boolean;
}

interface ResolvedQuotaBase {
  total?: number;
  used?: number;
  totalText: string;
  usedText: string;
  remainingPercent?: number;
  usedPercent?: number;
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
  // Sub2/CPA payloads are usually already in 0-100 percent scale.
  // Only treat strict fractional values (0,1) as ratios.
  if (value >= 0 && value < 1) {
    return value * 100;
  }
  return value;
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (Math.abs(value) >= 1) {
    return value.toFixed(2).replace(/\.00$/, "");
  }
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPercent(value: number): string {
  const normalized = normalizePercent(value);
  if (normalized >= 100) {
    return `${Math.round(normalized)}%`;
  }
  return `${normalized.toFixed(1)}%`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
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

function toDateKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const key = value.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return key;
  }
  return undefined;
}

function toOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) {
      return value;
    }
    if (value > 1e9) {
      return value * 1000;
    }
    return undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (numeric > 1e12) {
        return numeric;
      }
      if (numeric > 1e9) {
        return numeric * 1000;
      }
    }
  }
  return undefined;
}

function isExpiredResetAt(value: unknown): boolean {
  const timestamp = toOptionalTimestamp(value);
  if (typeof timestamp !== "number") {
    return false;
  }
  // Leave a small grace period around the exact reset edge.
  return timestamp <= Date.now() - 30_000;
}

function sumRecentHistoryUsedUsd(
  stats: Record<string, unknown> | undefined,
  recentDays: number
): number | undefined {
  if (!stats || recentDays <= 0) {
    return undefined;
  }

  const history = Array.isArray(stats.history) ? stats.history : [];
  if (!history.length) {
    return undefined;
  }

  const dayCostMap = new Map<string, number>();
  const orderedCosts: number[] = [];
  for (const entry of history) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }

    const dayUsed = pickFirstNonNegativeNumber([
      record.user_cost,
      record.userCost,
      record.total_user_cost,
      record.totalUserCost,
      record.used_usd,
      record.usedUsd,
      record.actual_cost,
      record.actualCost,
      record.total_actual_cost,
      record.totalActualCost,
      record.cost,
      record.total_cost,
      record.totalCost
    ]);
    if (typeof dayUsed !== "number") {
      continue;
    }
    orderedCosts.push(dayUsed);

    const dayKey = toDateKey(record.date ?? record.day ?? record.label);
    if (dayKey) {
      dayCostMap.set(dayKey, dayUsed);
    }
  }

  if (dayCostMap.size > 0) {
    const keys = Array.from(dayCostMap.keys()).sort();
    const recentKeys = keys.slice(-recentDays);
    const total = recentKeys.reduce((sum, key) => sum + (dayCostMap.get(key) ?? 0), 0);
    return Number.isFinite(total) ? total : undefined;
  }

  if (!orderedCosts.length) {
    return undefined;
  }

  const total = orderedCosts
    .slice(-recentDays)
    .reduce((sum, value) => sum + value, 0);
  return Number.isFinite(total) ? total : undefined;
}

function resolveUsedUsd(raw: Record<string, unknown>): number | undefined {
  const cpaEstimate = toRecord(raw.cpa_usage_cost_estimate);
  const fromEstimate = toOptionalNumber(cpaEstimate?.estimated_used_usd);
  if (typeof fromEstimate === "number" && fromEstimate >= 0) {
    return fromEstimate;
  }

  const direct = toOptionalNumber(
    raw.actual_cost ?? raw.total_actual_cost ?? raw.total_cost ?? raw.cost
  );
  if (typeof direct === "number" && direct >= 0) {
    return direct;
  }

  const stats = toRecord(raw.sub2_usage_stats);
  const summary = toRecord(stats?.summary);
  const fromSummary = toOptionalNumber(
    summary?.total_actual_cost ?? summary?.total_cost ?? summary?.total_user_cost
  );
  if (typeof fromSummary === "number" && fromSummary >= 0) {
    return fromSummary;
  }

  return undefined;
}

function resolveSub2UsedUsd(raw: Record<string, unknown>): number | undefined {
  // For sub2api, prefer sub2_usage_stats/window-scoped cost fields first.
  const stats = toRecord(raw.sub2_usage_stats);
  const summary = toRecord(stats?.summary);
  const sevenDayStats = toRecord(
    stats?.seven_day ?? stats?.sevenDay ?? stats?.window_7d
  );
  const sevenDaySummary = toRecord(sevenDayStats?.summary);
  const usageWindow = toRecord(raw.sub2_usage_window ?? raw.usage_window);
  const usageWindow7d = toRecord(
    usageWindow?.seven_day ?? usageWindow?.sevenDay ?? usageWindow?.window_7d
  );
  const usageWindow7dStats = toRecord(
    usageWindow7d?.window_stats ?? usageWindow7d?.windowStats
  );
  const extra = toRecord(raw.extra);
  const summaryDays = toOptionalNumber(summary?.days ?? summary?.window_days ?? summary?.windowDays);
  const history7dUsed = sumRecentHistoryUsedUsd(stats, 7);

  const prioritized = pickFirstNonNegativeNumber([
    raw.codex_7d_used_usd,
    raw.codex7dUsedUsd,
    raw.seven_day_used_usd,
    raw.sevenDayUsedUsd,
    raw.weekly_used_usd,
    raw.weeklyUsedUsd,
    usageWindow7dStats?.user_cost,
    usageWindow7dStats?.userCost,
    usageWindow7dStats?.actual_cost,
    usageWindow7dStats?.actualCost,
    usageWindow7dStats?.cost,
    usageWindow7dStats?.standard_cost,
    usageWindow7dStats?.standardCost,
    sevenDaySummary?.total_user_cost,
    sevenDaySummary?.totalUserCost,
    sevenDaySummary?.total_actual_cost,
    sevenDaySummary?.totalActualCost,
    sevenDaySummary?.total_cost,
    sevenDaySummary?.totalCost,
    sevenDaySummary?.user_cost,
    sevenDaySummary?.userCost,
    sevenDaySummary?.actual_cost,
    sevenDaySummary?.actualCost,
    sevenDaySummary?.used_usd,
    sevenDaySummary?.usedUsd,
    sevenDayStats?.total_user_cost,
    sevenDayStats?.totalUserCost,
    sevenDayStats?.total_actual_cost,
    sevenDayStats?.totalActualCost,
    sevenDayStats?.total_cost,
    sevenDayStats?.totalCost,
    sevenDayStats?.user_cost,
    sevenDayStats?.userCost,
    sevenDayStats?.actual_cost,
    sevenDayStats?.actualCost,
    sevenDayStats?.used_usd,
    sevenDayStats?.usedUsd,
    usageWindow7d?.total_user_cost,
    usageWindow7d?.totalUserCost,
    usageWindow7d?.total_actual_cost,
    usageWindow7d?.totalActualCost,
    usageWindow7d?.total_cost,
    usageWindow7d?.totalCost,
    usageWindow7d?.user_cost,
    usageWindow7d?.userCost,
    usageWindow7d?.actual_cost,
    usageWindow7d?.actualCost,
    usageWindow7d?.used_usd,
    usageWindow7d?.usedUsd,
    extra?.codex_7d_used_usd,
    extra?.codex7dUsedUsd,
    extra?.seven_day_used_usd,
    extra?.sevenDayUsedUsd,
    extra?.weekly_used_usd,
    extra?.weeklyUsedUsd,
    history7dUsed,
    typeof summaryDays === "number" && summaryDays <= 7 ? summary?.total_user_cost : undefined,
    typeof summaryDays === "number" && summaryDays <= 7 ? summary?.total_actual_cost : undefined,
    typeof summaryDays === "number" && summaryDays <= 7 ? summary?.total_cost : undefined
  ]);
  if (typeof prioritized === "number") {
    return prioritized;
  }

  return resolveUsedUsd(raw);
}

function resolveRemainingUsd(raw: Record<string, unknown>): number | undefined {
  const value = toOptionalNumber(
    raw.quota_remaining_usd ??
      raw.remaining_usd ??
      raw.balance_usd ??
      raw.credit_balance_usd
  );
  if (typeof value === "number" && value >= 0) {
    return value;
  }
  return undefined;
}

function inferTotalByUsage(options: {
  usedUsd?: number;
  remainingUsd?: number;
  remainingPercent?: number;
}): number | undefined {
  const { usedUsd, remainingUsd, remainingPercent } = options;
  if (
    typeof usedUsd === "number" &&
    usedUsd >= 0 &&
    typeof remainingUsd === "number" &&
    remainingUsd >= 0
  ) {
    return usedUsd + remainingUsd;
  }

  if (
    typeof remainingPercent === "number" &&
    typeof usedUsd === "number" &&
    usedUsd >= 0
  ) {
    const usedPercent = normalizePercent(100 - remainingPercent);
    if (usedPercent <= 0) {
      return undefined;
    }
    return usedUsd / (usedPercent / 100);
  }

  return undefined;
}

function getWindowSeconds(
  window: Record<string, unknown> | undefined
): number | undefined {
  if (!window) {
    return undefined;
  }
  return toOptionalNumber(window.limit_window_seconds ?? window.limitWindowSeconds);
}

function getWindowUsedPercent(
  window: Record<string, unknown> | undefined
): number | undefined {
  const direct = toOptionalNumber(window?.used_percent ?? window?.usedPercent);
  if (typeof direct === "number") {
    return normalizePercent(normalizePercentageLike(direct));
  }
  return undefined;
}

function pickCpaWeeklyWindow(
  limitInfo: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const WEEK_SECONDS = 604_800;
  const primaryWindow = toRecord(limitInfo?.primary_window ?? limitInfo?.primaryWindow);
  const secondaryWindow = toRecord(
    limitInfo?.secondary_window ?? limitInfo?.secondaryWindow
  );
  const windows = [primaryWindow, secondaryWindow];
  for (const window of windows) {
    if (!window) {
      continue;
    }
    if (getWindowSeconds(window) === WEEK_SECONDS) {
      return window;
    }
  }
  return secondaryWindow ?? primaryWindow;
}

function resolveSub2Quota(raw: Record<string, unknown>): ResolvedQuotaBase {
  const extra = toRecord(raw.extra);
  const usageWindow = toRecord(raw.sub2_usage_window ?? raw.usage_window);
  const usageWindow7d = toRecord(
    usageWindow?.seven_day ?? usageWindow?.sevenDay ?? usageWindow?.window_7d
  );
  const extraSevenDayResetAt =
    extra?.codex_7d_reset_at ??
    extra?.codex_primary_reset_at ??
    extra?.seven_day_reset_at ??
    extra?.weekly_reset_at;
  const usageWindow7dResetAt =
    usageWindow7d?.resets_at ??
    usageWindow7d?.resetsAt ??
    usageWindow7d?.reset_at ??
    usageWindow7d?.resetAt;

  // Prefer realtime usage window first, then fallback to extra cache fields.
  const codex7dCandidates: Array<{ value: unknown; resetAt?: unknown }> = [
    { value: usageWindow7d?.utilization, resetAt: usageWindow7dResetAt },
    { value: usageWindow7d?.used_percent, resetAt: usageWindow7dResetAt },
    { value: usageWindow7d?.usedPercent, resetAt: usageWindow7dResetAt },
    { value: extra?.codex_7d_used_percent, resetAt: extraSevenDayResetAt },
    { value: extra?.codex_7d_utilization, resetAt: extraSevenDayResetAt },
    { value: extra?.seven_day_used_percent, resetAt: extraSevenDayResetAt },
    { value: extra?.weekly_used_percent, resetAt: extraSevenDayResetAt }
  ];
  let hasExpiredPercentCandidate = false;
  for (const candidate of codex7dCandidates) {
    const value = toOptionalNumber(candidate.value);
    if (typeof value !== "number") {
      continue;
    }
    if (isExpiredResetAt(candidate.resetAt)) {
      hasExpiredPercentCandidate = true;
      continue;
    }
    const usedPercent = normalizePercent(normalizePercentageLike(value));
    return {
      total: 100,
      used: usedPercent,
      totalText: "7d限额 100%",
      usedText: formatPercent(usedPercent),
      remainingPercent: normalizePercent(100 - usedPercent),
      usedPercent
    };
  }
  if (hasExpiredPercentCandidate) {
    return {
      total: 100,
      used: 0,
      totalText: "7d限额 100%",
      usedText: formatPercent(0),
      remainingPercent: 100,
      usedPercent: 0
    };
  }

  const windows = [
    {
      label: "总额度",
      total: toOptionalNumber(raw.quota_limit),
      used: toOptionalNumber(raw.quota_used)
    },
    {
      label: "周额度",
      total: toOptionalNumber(raw.quota_weekly_limit),
      used: toOptionalNumber(raw.quota_weekly_used)
    },
    {
      label: "日额度",
      total: toOptionalNumber(raw.quota_daily_limit),
      used: toOptionalNumber(raw.quota_daily_used)
    }
  ];

  const selectedWindow = windows.find(
    (item) => typeof item.total === "number" && item.total > 0
  );
  if (selectedWindow && typeof selectedWindow.total === "number") {
    const total = selectedWindow.total;
    const used = selectedWindow.used ?? 0;
    const usedPercent = normalizePercent((used / total) * 100);
    return {
      total,
      used,
      totalText: `${selectedWindow.label} ${formatNumber(total)}`,
      usedText: `${formatNumber(used)} (${formatPercent(usedPercent)})`,
      remainingPercent: normalizePercent(100 - usedPercent),
      usedPercent
    };
  }

  return {
    totalText: "-",
    usedText: "-"
  };
}
function resolveCpaQuota(raw: Record<string, unknown>): ResolvedQuotaBase {
  const usagePayload = toRecord(raw.cpa_quota_usage);
  const rateLimit = toRecord(usagePayload?.rate_limit ?? usagePayload?.rateLimit);
  const weeklyWindow = pickCpaWeeklyWindow(rateLimit);
  let usedPercent = getWindowUsedPercent(weeklyWindow);

  if (typeof usedPercent !== "number") {
    const directUsed = toOptionalNumber(
      raw.weekly_used_percent ?? raw.codex_weekly_used_percent ?? raw.week_used_percent
    );
    if (typeof directUsed === "number") {
      usedPercent = normalizePercent(normalizePercentageLike(directUsed));
    }
  }

  if (typeof usedPercent !== "number") {
    const directRemaining = toOptionalNumber(
      raw.weekly_remaining_percent ??
        raw.codex_weekly_remaining_percent ??
        raw.week_remaining_percent
    );
    if (typeof directRemaining === "number") {
      const remaining = normalizePercent(normalizePercentageLike(directRemaining));
      usedPercent = normalizePercent(100 - remaining);
    }
  }

  if (typeof usedPercent === "number") {
    return {
      total: 100,
      used: usedPercent,
      totalText: "7d限额 100%",
      usedText: formatPercent(usedPercent),
      remainingPercent: normalizePercent(100 - usedPercent),
      usedPercent
    };
  }

  return {
    totalText: "-",
    usedText: "-"
  };
}

export function buildAccountQuotaMetrics(account: UnifiedAccount): QuotaCardMetrics {
  const raw = toRecord(account.raw);
  if (!raw) {
    return {
      totalText: "-",
      usedText: "-",
      exhausted: false
    };
  }

  const usedUsd =
    account.platform === "sub2api" ? resolveSub2UsedUsd(raw) : resolveUsedUsd(raw);
  const remainingUsd = resolveRemainingUsd(raw);
  const base =
    account.platform === "sub2api" ? resolveSub2Quota(raw) : resolveCpaQuota(raw);
  const preferPercentBasedTotal =
    account.platform === "sub2api" && typeof base.usedPercent === "number";

  const inferredTotalUsd = inferTotalByUsage({
    usedUsd,
    remainingUsd: preferPercentBasedTotal ? undefined : remainingUsd,
    remainingPercent: base.remainingPercent
  });
  const monetaryTotalUsd =
    !preferPercentBasedTotal &&
    typeof usedUsd === "number" &&
    usedUsd >= 0 &&
    typeof remainingUsd === "number" &&
    remainingUsd >= 0
      ? usedUsd + remainingUsd
      : inferredTotalUsd;

  const totalUsdValue =
    typeof monetaryTotalUsd === "number" && monetaryTotalUsd > 0
      ? monetaryTotalUsd
      : undefined;
  const usedUsdValue =
    typeof usedUsd === "number" && usedUsd >= 0 ? usedUsd : undefined;
  const usdQuotaValue =
    totalUsdValue ?? (typeof usedUsdValue === "number" && usedUsdValue > 0 ? usedUsdValue : undefined);

  let totalValue = usdQuotaValue ?? base.total;
  let usedValue = base.used;
  let totalText = base.totalText;
  let usedText = base.usedText;

  if (
    (typeof totalValue !== "number" || totalValue <= 0) &&
    typeof inferredTotalUsd === "number" &&
    inferredTotalUsd > 0
  ) {
    totalValue = inferredTotalUsd;
    totalText = `估算 ${formatUsd(inferredTotalUsd)}`;
  }

  if (typeof usedUsdValue === "number") {
    usedValue = usedUsdValue;
    usedText = usedText === "-" ? formatUsd(usedUsdValue) : `${usedText} / ${formatUsd(usedUsdValue)}`;
  }

  if (
    typeof remainingUsd === "number" &&
    totalText !== "-" &&
    !totalText.includes("估算") &&
    typeof usedUsdValue !== "number"
  ) {
    totalText = `${totalText} / ${formatUsd(remainingUsd + (usedUsdValue ?? 0))}`;
  }

  const usedPercent = base.usedPercent;
  const exhausted = typeof usedPercent === "number" && usedPercent >= 99.95;

  return {
    totalText,
    usedText,
    totalValue,
    usedValue,
    usedUsdValue,
    totalUsdValue,
    usdQuotaValue,
    remainingPercent: base.remainingPercent,
    usedPercent,
    exhausted
  };
}

