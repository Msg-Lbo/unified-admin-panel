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
  if (value >= 0 && value <= 1) {
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

function resolveUsedUsd(raw: Record<string, unknown>): number | undefined {
  // For CPA payloads, direct top-level cost fields are usually the most accurate.
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

  const cpaEstimate = toRecord(raw.cpa_usage_cost_estimate);
  const fromEstimate = toOptionalNumber(cpaEstimate?.estimated_used_usd);
  if (typeof fromEstimate === "number" && fromEstimate >= 0) {
    return fromEstimate;
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
  const extra = toRecord(raw.extra);

  const prioritized = pickFirstNonNegativeNumber([
    sevenDaySummary?.total_actual_cost,
    sevenDaySummary?.total_cost,
    sevenDaySummary?.total_user_cost,
    sevenDayStats?.total_actual_cost,
    sevenDayStats?.total_cost,
    sevenDayStats?.total_user_cost,
    sevenDayStats?.actual_cost,
    sevenDayStats?.user_cost,
    sevenDayStats?.used_usd,
    usageWindow7d?.total_actual_cost,
    usageWindow7d?.total_cost,
    usageWindow7d?.total_user_cost,
    usageWindow7d?.actual_cost,
    usageWindow7d?.user_cost,
    usageWindow7d?.used_usd,
    summary?.total_actual_cost,
    summary?.total_cost,
    summary?.total_user_cost,
    extra?.codex_7d_used_usd,
    extra?.seven_day_used_usd,
    extra?.weekly_used_usd
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

  // 对齐 sub2api 的 7d 进度口径：有 codex 7d 百分比就优先使用。
  const codex7dCandidates = [
    extra?.codex_7d_used_percent,
    extra?.codex_7d_utilization,
    extra?.seven_day_used_percent,
    extra?.weekly_used_percent,
    usageWindow7d?.utilization,
    usageWindow7d?.used_percent
  ];
  for (const candidate of codex7dCandidates) {
    const value = toOptionalNumber(candidate);
    if (typeof value !== "number") {
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
  let usedPercent = getWindowUsedPercent(weeklyWindow, rateLimit);

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

  const inferredTotalUsd = inferTotalByUsage({
    usedUsd,
    remainingUsd,
    remainingPercent: base.remainingPercent
  });
  const monetaryTotalUsd =
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
