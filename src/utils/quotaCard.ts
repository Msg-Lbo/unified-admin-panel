import type { UnifiedAccount } from "../types/platform";

export interface UsageWindowMetric {
  window: "5h" | "7d";
  usedPercent?: number;
  remainingPercent?: number;
  resetAt?: string;
  resetAtLabel?: string;
  usedUsdValue?: number;
}

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
  usageWindows?: UsageWindowMetric[];
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

function isLimitExhaustedStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return (
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
  );
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

function formatResetAtLabel(value: unknown): string | undefined {
  const timestamp = toOptionalTimestamp(value);
  if (typeof timestamp !== "number") {
    return undefined;
  }
  const now = Date.now();
  if (timestamp <= now + 60_000) {
    return "即将刷新";
  }
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

interface ResolvedWindowUsage {
  usedPercent?: number;
  remainingPercent?: number;
  resetAt?: string;
  resetAtLabel?: string;
}

function pickWindowUsage(
  candidates: Array<{ value: unknown; resetAt?: unknown }>
): ResolvedWindowUsage | undefined {
  let hasExpiredCandidate = false;
  let expiredResetAt: unknown;

  for (const candidate of candidates) {
    const value = toOptionalNumber(candidate.value);
    if (typeof value !== "number") {
      continue;
    }
    if (isExpiredResetAt(candidate.resetAt)) {
      hasExpiredCandidate = true;
      expiredResetAt = candidate.resetAt;
      continue;
    }
    const usedPercent = normalizePercent(normalizePercentageLike(value));
    return {
      usedPercent,
      remainingPercent: normalizePercent(100 - usedPercent),
      resetAt:
        typeof candidate.resetAt === "string" && candidate.resetAt.trim()
          ? candidate.resetAt.trim()
          : undefined,
      resetAtLabel: formatResetAtLabel(candidate.resetAt)
    };
  }

  if (hasExpiredCandidate) {
    return {
      usedPercent: 0,
      remainingPercent: 100,
      resetAt:
        typeof expiredResetAt === "string" && expiredResetAt.trim()
          ? expiredResetAt.trim()
          : undefined,
      resetAtLabel: formatResetAtLabel(expiredResetAt)
    };
  }

  return undefined;
}

type Sub2PlanType = "free" | "plus" | "team" | "pro" | "unknown";

function normalizeSub2PlanType(rawType: string): Sub2PlanType {
  const value = rawType.trim().toLowerCase();
  if (!value) {
    return "unknown";
  }
  if (value.includes("team")) {
    return "team";
  }
  if (value.includes("chatgptpro") || value.includes(" pro")) {
    return "pro";
  }
  if (value.includes("plus")) {
    return "plus";
  }
  if (value.includes("free")) {
    return "free";
  }
  if (value === "pro") {
    return "pro";
  }
  return "unknown";
}

function resolveSub2PlanType(raw: Record<string, unknown>): Sub2PlanType {
  const credentials = toRecord(raw.credentials);
  const extra = toRecord(raw.extra);
  const candidates: string[] = [];
  for (const candidate of [
    credentials?.plan_type,
    credentials?.planType,
    credentials?.chatgpt_plan_type,
    credentials?.chatgptPlanType,
    raw.plan_type,
    raw.planType,
    raw.subscription_plan,
    raw.subscriptionPlan,
    extra?.plan_type,
    extra?.planType
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      candidates.push(candidate);
    }
  }

  for (const candidate of candidates) {
    const planType = normalizeSub2PlanType(candidate);
    if (planType !== "unknown") {
      return planType;
    }
  }
  return "unknown";
}

function resolveSub2FiveHourWindowMinutes(
  extra: Record<string, unknown> | undefined,
  usageWindow5h: Record<string, unknown> | undefined
): number | undefined {
  const fromExtra = toOptionalNumber(
    extra?.codex_5h_window_minutes ?? extra?.codex5hWindowMinutes
  );
  if (typeof fromExtra === "number") {
    return fromExtra;
  }
  return toOptionalNumber(usageWindow5h?.window_minutes ?? usageWindow5h?.windowMinutes);
}

function hasActiveSub2FiveHourWindow(
  raw: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
  usageWindow5h: Record<string, unknown> | undefined
): boolean {
  const windowMinutes = resolveSub2FiveHourWindowMinutes(extra, usageWindow5h);
  if (typeof windowMinutes === "number") {
    return windowMinutes > 0;
  }
  if (resolveSub2PlanType(raw) === "free") {
    return false;
  }
  return Boolean(usageWindow5h);
}

function resolveSub2FiveHourWindowUsage(
  usageWindow5h: Record<string, unknown> | undefined,
  extra: Record<string, unknown> | undefined,
  fiveHourResetAt: unknown
): ResolvedWindowUsage | undefined {
  const fromPercent = pickWindowUsage([
    { value: usageWindow5h?.utilization, resetAt: fiveHourResetAt },
    { value: usageWindow5h?.used_percent, resetAt: fiveHourResetAt },
    { value: usageWindow5h?.usedPercent, resetAt: fiveHourResetAt },
    { value: extra?.codex_5h_used_percent, resetAt: fiveHourResetAt },
    { value: extra?.codex_5h_utilization, resetAt: fiveHourResetAt }
  ]);
  if (fromPercent) {
    return fromPercent;
  }

  if (!usageWindow5h) {
    return undefined;
  }

  const windowStats = toRecord(usageWindow5h.window_stats ?? usageWindow5h.windowStats);
  const hasWindowData =
    typeof pickRecordUsedUsd(windowStats) === "number" ||
    typeof toOptionalNumber(usageWindow5h.remaining_seconds ?? usageWindow5h.remainingSeconds) ===
      "number" ||
    typeof usageWindow5h.resets_at === "string" ||
    typeof usageWindow5h.resetsAt === "string";

  if (!hasWindowData) {
    return undefined;
  }

  return {
    usedPercent: 0,
    remainingPercent: 100,
    resetAt:
      typeof fiveHourResetAt === "string" && fiveHourResetAt.trim()
        ? fiveHourResetAt.trim()
        : undefined,
    resetAtLabel: formatResetAtLabel(fiveHourResetAt)
  };
}

function resolveWindowUsedUsd(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return 0;
}

function resolveSub2UsageWindows(raw: Record<string, unknown>): UsageWindowMetric[] {
  if (resolveSub2PlanType(raw) === "unknown") {
    return [];
  }

  const extra = toRecord(raw.extra);
  const usageWindow = toRecord(raw.sub2_usage_window ?? raw.usage_window);
  const usageWindow5h = toRecord(
    usageWindow?.five_hour ??
      usageWindow?.fiveHour ??
      usageWindow?.window_5h ??
      usageWindow?.codex_5h ??
      usageWindow?.hour_5
  );
  const usageWindow7d = toRecord(
    usageWindow?.seven_day ?? usageWindow?.sevenDay ?? usageWindow?.window_7d
  );
  const fiveHourResetAt =
    usageWindow5h?.resets_at ??
    usageWindow5h?.resetsAt ??
    usageWindow5h?.reset_at ??
    usageWindow5h?.resetAt ??
    extra?.codex_5h_reset_at ??
    extra?.codex5hResetAt;
  const sevenDayResetAt =
    usageWindow7d?.resets_at ??
    usageWindow7d?.resetsAt ??
    usageWindow7d?.reset_at ??
    usageWindow7d?.resetAt ??
    extra?.codex_7d_reset_at ??
    extra?.codex_primary_reset_at ??
    extra?.seven_day_reset_at ??
    extra?.weekly_reset_at;

  const windows: UsageWindowMetric[] = [];
  const hasFiveHourWindow = hasActiveSub2FiveHourWindow(raw, extra, usageWindow5h);
  const fiveHourUsedUsd = resolveWindowUsedUsd(
    hasFiveHourWindow ? resolveSub2FiveHourUsedUsd(raw) : undefined
  );
  const sevenDayUsedUsd = resolveWindowUsedUsd(resolveSub2SevenDayUsedUsd(raw));

  if (hasFiveHourWindow) {
    const fiveHour = resolveSub2FiveHourWindowUsage(usageWindow5h, extra, fiveHourResetAt);
    if (fiveHour) {
      windows.push({ window: "5h", ...fiveHour, usedUsdValue: fiveHourUsedUsd });
    }
  }

  const sevenDay = pickWindowUsage([
    { value: usageWindow7d?.utilization, resetAt: sevenDayResetAt },
    { value: usageWindow7d?.used_percent, resetAt: sevenDayResetAt },
    { value: usageWindow7d?.usedPercent, resetAt: sevenDayResetAt },
    { value: extra?.codex_7d_used_percent, resetAt: sevenDayResetAt },
    { value: extra?.codex_7d_utilization, resetAt: sevenDayResetAt },
    { value: extra?.seven_day_used_percent, resetAt: sevenDayResetAt },
    { value: extra?.weekly_used_percent, resetAt: sevenDayResetAt }
  ]);
  if (sevenDay) {
    windows.push({ window: "7d", ...sevenDay, usedUsdValue: sevenDayUsedUsd });
  }

  return windows;
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

function pickRecordUsedUsd(record: Record<string, unknown> | undefined): number | undefined {
  if (!record) {
    return undefined;
  }
  return pickFirstNonNegativeNumber([
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
    record.totalCost,
    record.standard_cost,
    record.standardCost
  ]);
}

function resolveSub2FiveHourUsedUsd(raw: Record<string, unknown>): number | undefined {
  const stats = toRecord(raw.sub2_usage_stats);
  const fiveHourStats = toRecord(
    stats?.five_hour ?? stats?.fiveHour ?? stats?.window_5h ?? stats?.hour_5 ?? stats?.codex_5h
  );
  const fiveHourSummary = toRecord(fiveHourStats?.summary);
  const usageWindow = toRecord(raw.sub2_usage_window ?? raw.usage_window);
  const usageWindow5h = toRecord(
    usageWindow?.five_hour ??
      usageWindow?.fiveHour ??
      usageWindow?.window_5h ??
      usageWindow?.codex_5h ??
      usageWindow?.hour_5
  );
  const usageWindow5hStats = toRecord(
    usageWindow5h?.window_stats ?? usageWindow5h?.windowStats
  );
  const extra = toRecord(raw.extra);

  return pickFirstNonNegativeNumber([
    raw.codex_5h_used_usd,
    raw.codex5hUsedUsd,
    raw.five_hour_used_usd,
    raw.fiveHourUsedUsd,
    pickRecordUsedUsd(usageWindow5hStats),
    pickRecordUsedUsd(fiveHourSummary),
    pickRecordUsedUsd(fiveHourStats),
    pickRecordUsedUsd(usageWindow5h),
    extra?.codex_5h_used_usd,
    extra?.codex5hUsedUsd,
    extra?.five_hour_used_usd,
    extra?.fiveHourUsedUsd
  ]);
}

function resolveSub2SevenDayUsedUsd(raw: Record<string, unknown>): number | undefined {
  const stats = toRecord(raw.sub2_usage_stats);
  const summary = toRecord(stats?.summary);
  const sevenDayStats = toRecord(
    stats?.seven_day ?? stats?.sevenDay ?? stats?.window_7d
  );
  const sevenDaySummary = toRecord(sevenDayStats?.summary);
  const usageWindow = toRecord(raw.sub2_usage_window ?? raw.usage_window);
  const usageWindow5h = toRecord(
    usageWindow?.five_hour ??
      usageWindow?.fiveHour ??
      usageWindow?.window_5h ??
      usageWindow?.codex_5h ??
      usageWindow?.hour_5
  );
  const usageWindow7d = toRecord(
    usageWindow?.seven_day ?? usageWindow?.sevenDay ?? usageWindow?.window_7d
  );
  const usageWindow7dStats = toRecord(
    usageWindow7d?.window_stats ?? usageWindow7d?.windowStats
  );
  const usageWindow5hStats = toRecord(
    usageWindow5h?.window_stats ?? usageWindow5h?.windowStats
  );
  const extra = toRecord(raw.extra);
  const summaryDays = toOptionalNumber(summary?.days ?? summary?.window_days ?? summary?.windowDays);
  const history7dUsed = sumRecentHistoryUsedUsd(stats, 7);

  const fromSevenDay = pickFirstNonNegativeNumber([
    raw.codex_7d_used_usd,
    raw.codex7dUsedUsd,
    raw.seven_day_used_usd,
    raw.sevenDayUsedUsd,
    raw.weekly_used_usd,
    raw.weeklyUsedUsd,
    pickRecordUsedUsd(usageWindow7dStats),
    pickRecordUsedUsd(sevenDaySummary),
    pickRecordUsedUsd(sevenDayStats),
    pickRecordUsedUsd(usageWindow7d),
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

  if (
    (!fromSevenDay || fromSevenDay === 0) &&
    !hasActiveSub2FiveHourWindow(raw, extra, usageWindow5h)
  ) {
    const reassignedFromFiveHour = pickRecordUsedUsd(usageWindow5hStats);
    if (typeof reassignedFromFiveHour === "number" && reassignedFromFiveHour > 0) {
      return reassignedFromFiveHour;
    }
  }

  return fromSevenDay;
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
  const sevenDayUsed = resolveSub2SevenDayUsedUsd(raw);
  if (typeof sevenDayUsed === "number") {
    return sevenDayUsed;
  }
  return resolveUsedUsd(raw);
}

function buildUsedDisplayText(
  base: ResolvedQuotaBase,
  usedUsdValue?: number
): string {
  const hasPercent = typeof base.usedPercent === "number";
  const hasUsd = typeof usedUsdValue === "number";

  if (hasPercent && hasUsd) {
    return `${formatPercent(base.usedPercent as number)} · ${formatUsd(usedUsdValue as number)}`;
  }
  if (hasUsd) {
    return formatUsd(usedUsdValue as number);
  }
  if (hasPercent) {
    return formatPercent(base.usedPercent as number);
  }
  const text = base.usedText.trim();
  return text.length > 0 && text !== "-" ? text : "-";
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
  const forceExhausted = isLimitExhaustedStatus(account.status);
  const raw = toRecord(account.raw);
  if (!raw) {
    return {
      totalText: "-",
      usedText: forceExhausted ? formatPercent(100) : "-",
      remainingPercent: forceExhausted ? 0 : undefined,
      usedPercent: forceExhausted ? 100 : undefined,
      exhausted: forceExhausted
    };
  }

  const usedUsd =
    account.platform === "sub2api" ? resolveSub2UsedUsd(raw) : resolveUsedUsd(raw);
  const base =
    account.platform === "sub2api" ? resolveSub2Quota(raw) : resolveCpaQuota(raw);
  const usedUsdValue =
    typeof usedUsd === "number" && usedUsd >= 0 ? usedUsd : undefined;

  const usageWindows =
    account.platform === "sub2api" ? resolveSub2UsageWindows(raw) : undefined;
  const sevenDayWindow = usageWindows?.find((item) => item.window === "7d");
  const fiveHourWindow = usageWindows?.find((item) => item.window === "5h");

  let usedPercent = forceExhausted ? 100 : base.usedPercent;
  let remainingPercent = forceExhausted ? 0 : base.remainingPercent;
  if (!forceExhausted && sevenDayWindow) {
    if (typeof sevenDayWindow.usedPercent === "number") {
      usedPercent = sevenDayWindow.usedPercent;
    }
    if (typeof sevenDayWindow.remainingPercent === "number") {
      remainingPercent = sevenDayWindow.remainingPercent;
    }
  } else if (!forceExhausted && fiveHourWindow && typeof usedPercent !== "number") {
    usedPercent = fiveHourWindow.usedPercent;
    remainingPercent = fiveHourWindow.remainingPercent;
  }

  const exhausted = forceExhausted || (typeof usedPercent === "number" && usedPercent >= 99.95);

  return {
    totalText: "-",
    usedText: buildUsedDisplayText(base, usedUsdValue),
    totalValue: undefined,
    usedValue: usedUsdValue ?? base.used,
    usedUsdValue,
    totalUsdValue: undefined,
    usdQuotaValue: usedUsdValue,
    remainingPercent,
    usedPercent,
    usageWindows: usageWindows?.length ? usageWindows : undefined,
    exhausted
  };
}

export function resolveAccountPlanType(account: UnifiedAccount): Sub2PlanType {
  const raw = toRecord(account.raw);
  if (!raw) {
    return "unknown";
  }
  return resolveSub2PlanType(raw);
}

export function isUnknownPlanAccount(account: UnifiedAccount): boolean {
  return resolveAccountPlanType(account) === "unknown";
}

export function shouldFetchSub2QuotaDetails(_raw: Record<string, unknown>): boolean {
  return true;
}

