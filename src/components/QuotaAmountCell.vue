<script setup lang="ts">
import { computed } from "vue";
import type { UnifiedAccount } from "../types/platform";

interface QuotaDisplay {
  totalText: string;
  usedText: string;
  note?: string;
}

const props = defineProps<{
  account: UnifiedAccount;
}>();

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

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString(undefined, {
      maximumFractionDigits: 2
    });
  }
  if (Math.abs(value) >= 1) {
    return value.toFixed(2).replace(/\.00$/, "");
  }
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function extractQuotaWindow(
  raw: Record<string, unknown>
): { label: string; total?: number; used?: number } {
  const windows = [
    {
      label: "总",
      total: toOptionalNumber(raw.quota_limit),
      used: toOptionalNumber(raw.quota_used)
    },
    {
      label: "周",
      total: toOptionalNumber(raw.quota_weekly_limit),
      used: toOptionalNumber(raw.quota_weekly_used)
    },
    {
      label: "日",
      total: toOptionalNumber(raw.quota_daily_limit),
      used: toOptionalNumber(raw.quota_daily_used)
    }
  ];

  for (const item of windows) {
    if (typeof item.total === "number" && item.total > 0) {
      return item;
    }
  }
  return { label: "总" };
}

function resolveUsedUsd(raw: Record<string, unknown>): number | undefined {
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

function resolveRemainingUsd(raw: Record<string, unknown>): number | undefined {
  const direct = toOptionalNumber(
    raw.quota_remaining_usd ??
      raw.remaining_usd ??
      raw.balance_usd ??
      raw.credit_balance_usd
  );
  if (typeof direct === "number" && direct >= 0) {
    return direct;
  }
  return undefined;
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
  weeklyWindow?: Record<string, unknown>;
} {
  const WEEK_SECONDS = 604_800;
  const primaryWindow = toRecord(limitInfo?.primary_window ?? limitInfo?.primaryWindow);
  const secondaryWindow = toRecord(
    limitInfo?.secondary_window ?? limitInfo?.secondaryWindow
  );
  const windows = [primaryWindow, secondaryWindow];

  let weeklyWindow: Record<string, unknown> | undefined;
  for (const window of windows) {
    if (!window) {
      continue;
    }
    const seconds = getWindowSeconds(window);
    if (seconds === WEEK_SECONDS && !weeklyWindow) {
      weeklyWindow = window;
    }
  }
  if (!weeklyWindow && secondaryWindow) {
    weeklyWindow = secondaryWindow;
  }
  return { weeklyWindow };
}

function resolveRemainingPercent(raw: Record<string, unknown>, platform: UnifiedAccount["platform"]): number | undefined {
  if (platform === "sub2api") {
    const extra = toRecord(raw.extra);
    const weeklyUsedRaw = toOptionalNumber(extra?.codex_7d_used_percent);
    if (typeof weeklyUsedRaw === "number") {
      return normalizePercent(100 - normalizePercentageLike(weeklyUsedRaw));
    }

    const quotaPairs: Array<[unknown, unknown]> = [
      [raw.quota_limit, raw.quota_used],
      [raw.quota_weekly_limit, raw.quota_weekly_used],
      [raw.quota_daily_limit, raw.quota_daily_used]
    ];
    for (const [limitRaw, usedRaw] of quotaPairs) {
      const limit = toOptionalNumber(limitRaw);
      const used = toOptionalNumber(usedRaw) ?? 0;
      if (typeof limit === "number" && limit > 0) {
        return normalizePercent(100 - (used / limit) * 100);
      }
    }
    return undefined;
  }

  const usagePayload = toRecord(raw.cpa_quota_usage);
  const rateLimit = toRecord(usagePayload?.rate_limit ?? usagePayload?.rateLimit);
  const weeklyWindow = pickClassifiedWindows(rateLimit).weeklyWindow;
  const weeklyUsed = getWindowUsedPercent(weeklyWindow, rateLimit);
  if (typeof weeklyUsed === "number") {
    return normalizePercent(100 - weeklyUsed);
  }

  const directRemaining = toOptionalNumber(
    raw.weekly_remaining_percent ??
      raw.codex_weekly_remaining_percent ??
      raw.week_remaining_percent
  );
  if (typeof directRemaining === "number") {
    return normalizePercent(normalizePercentageLike(directRemaining));
  }

  const directUsed = toOptionalNumber(
    raw.weekly_used_percent ??
      raw.codex_weekly_used_percent ??
      raw.week_used_percent
  );
  if (typeof directUsed === "number") {
    return normalizePercent(100 - normalizePercentageLike(directUsed));
  }
  return undefined;
}

function inferTotalUsdFromUsage(options: {
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

  if (typeof remainingPercent === "number") {
    const normalizedRemaining = normalizePercent(remainingPercent);
    const usedPercent = normalizePercent(100 - normalizedRemaining);

    if (typeof usedUsd === "number" && usedUsd >= 0) {
      if (usedPercent <= 0) {
        return undefined;
      }
      return usedUsd / (usedPercent / 100);
    }

    if (typeof remainingUsd === "number" && remainingUsd >= 0) {
      if (normalizedRemaining <= 0) {
        return undefined;
      }
      return remainingUsd / (normalizedRemaining / 100);
    }
  }

  return undefined;
}

function buildQuotaDisplay(account: UnifiedAccount): QuotaDisplay | undefined {
  const raw = toRecord(account.raw);
  if (!raw) {
    return undefined;
  }

  const window = extractQuotaWindow(raw);
  const usedUsd = resolveUsedUsd(raw);
  const remainingUsd = resolveRemainingUsd(raw);
  const remainingPercent = resolveRemainingPercent(raw, account.platform);
  const inferredTotalUsd = inferTotalUsdFromUsage({
    usedUsd,
    remainingUsd,
    remainingPercent
  });

  const hasWindowTotal = typeof window.total === "number" && window.total > 0;
  const hasWindowUsed = typeof window.used === "number" && window.used >= 0;

  if (hasWindowTotal || hasWindowUsed || typeof usedUsd === "number") {
    let totalText = hasWindowTotal ? `${window.label}额度 ${formatNumber(window.total!)}` : "-";
    if (!hasWindowTotal && typeof inferredTotalUsd === "number" && inferredTotalUsd > 0) {
      totalText = `估算 ${formatUsd(inferredTotalUsd)}`;
    }
    let usedText = hasWindowUsed ? formatNumber(window.used!) : "-";
    if (typeof usedUsd === "number") {
      usedText = `${usedText === "-" ? "" : `${usedText} · `}${formatUsd(usedUsd)}`;
    }
    const noteParts: string[] = [];
    if (typeof remainingUsd === "number") {
      noteParts.push(`剩余：${formatUsd(remainingUsd)}`);
    }
    if (typeof remainingPercent === "number") {
      noteParts.push(`剩余比例：${normalizePercent(remainingPercent).toFixed(1)}%`);
    }
    const note = noteParts.length ? noteParts.join(" · ") : undefined;
    return {
      totalText,
      usedText,
      note
    };
  }

  return undefined;
}

const display = computed(() => buildQuotaDisplay(props.account));
</script>

<template>
  <div v-if="display" class="quota-amount-cell">
    <p class="quota-amount-line">
      <span class="quota-amount-label">总额度</span>
      <span class="quota-amount-value">{{ display.totalText }}</span>
    </p>
    <p class="quota-amount-line">
      <span class="quota-amount-label">已用额度</span>
      <span class="quota-amount-value">{{ display.usedText }}</span>
    </p>
    <p v-if="display.note" class="quota-amount-note">{{ display.note }}</p>
  </div>
  <span v-else class="usage-progress-empty">-</span>
</template>
