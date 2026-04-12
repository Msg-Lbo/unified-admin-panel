<script setup lang="ts">
import { computed } from "vue";
import type { UnifiedAccount } from "../types/platform";

type ProgressTone = "success" | "warning" | "error";

interface ProgressItem {
  key: string;
  label: string;
  percentage: number;
  text: string;
  resetText?: string;
  tone: ProgressTone;
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

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
  return undefined;
}

function normalizePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function formatMetric(value: number): string {
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

function formatPercent(value: number): string {
  if (value >= 100) {
    return `${Math.round(value)}%`;
  }
  if (value >= 10) {
    return `${value.toFixed(1)}%`;
  }
  return `${value.toFixed(2)}%`;
}

function parseDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatResetHint(resetAt?: string): string | undefined {
  const date = parseDate(resetAt);
  if (!date) {
    return undefined;
  }
  const diff = date.getTime() - Date.now();
  if (diff <= 0) {
    return "已重置";
  }
  const totalMinutes = Math.floor(diff / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}天${hours}小时后重置`;
  }
  if (hours > 0) {
    return `${hours}小时${minutes}分钟后重置`;
  }
  return `${minutes}分钟后重置`;
}

function resolveRemainingTone(remainingPercent: number): ProgressTone {
  if (remainingPercent <= 0) {
    return "error";
  }
  if (remainingPercent <= 20) {
    return "warning";
  }
  return "success";
}

function normalizePercentageLike(value: number): number {
  if (value >= 0 && value <= 1) {
    return value * 100;
  }
  return value;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizePlanTypeValue(value: unknown): string | undefined {
  const normalized = toStringValue(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.toLowerCase();
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

function parseLooseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
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
    return undefined;
  }
  return undefined;
}

function resolveAccountPlanType(
  raw: Record<string, unknown>,
  payload?: Record<string, unknown>
): string | undefined {
  const idToken = parseIdTokenPayload(raw.id_token);
  const metadata = toRecord(raw.metadata);
  const attributes = toRecord(raw.attributes);
  const credentials = toRecord(raw.credentials);
  const credentialIdToken = parseIdTokenPayload(credentials?.id_token);
  const metadataIdToken = parseIdTokenPayload(metadata?.id_token);
  const attributeIdToken = parseIdTokenPayload(attributes?.id_token);
  const statusMessage = parseLooseJsonRecord(raw.status_message);
  const errorMessage = parseLooseJsonRecord(raw.error_message);
  const statusMessageError = toRecord(statusMessage?.error);
  const errorMessageError = toRecord(errorMessage?.error);

  const candidates: unknown[] = [
    raw.plan_type,
    raw.planType,
    payload?.plan_type,
    payload?.planType,
    credentials?.plan_type,
    credentials?.planType,
    credentials?.chatgpt_plan_type,
    credentials?.chatgptPlanType,
    idToken?.plan_type,
    idToken?.planType,
    metadata?.plan_type,
    metadata?.planType,
    metadataIdToken?.plan_type,
    metadataIdToken?.planType,
    attributes?.plan_type,
    attributes?.planType,
    attributeIdToken?.plan_type,
    attributeIdToken?.planType,
    credentialIdToken?.plan_type,
    credentialIdToken?.planType,
    statusMessage?.plan_type,
    statusMessage?.planType,
    statusMessageError?.plan_type,
    statusMessageError?.planType,
    errorMessage?.plan_type,
    errorMessage?.planType,
    errorMessageError?.plan_type,
    errorMessageError?.planType,
    raw.account,
    raw.name,
    raw.id,
    raw.label
  ];
  for (const candidate of candidates) {
    const normalized = normalizePlanTypeValue(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function getRemainingHue(remainingPercent: number): number {
  const clamped = normalizePercent(remainingPercent);
  return Math.round((clamped / 100) * 165);
}

function buildFillStyle(item: ProgressItem): Record<string, string> {
  const cpaExhausted =
    item.key.startsWith("cpa-") &&
    item.percentage <= 0 &&
    item.text.includes("已用尽");
  const renderPercent = cpaExhausted ? 0 : item.percentage;
  const hue = getRemainingHue(item.percentage);
  const start = `hsl(${Math.min(180, hue + 12)}, 86%, 48%)`;
  const end = `hsl(${Math.max(0, hue - 8)}, 78%, 41%)`;
  return {
    width: `${renderPercent}%`,
    background: `linear-gradient(90deg, ${start}, ${end})`
  };
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
        return normalizePercentageLike(value);
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

function pickPercentByRegex(content: string | undefined, matcher: RegExp): number | undefined {
  if (!content) {
    return undefined;
  }
  const matched = content.match(matcher);
  if (!matched || matched.length < 2) {
    return undefined;
  }
  const parsed = Number(matched[1]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return normalizePercentageLike(parsed);
}

function buildCodexProgressItems(raw: Record<string, unknown>): ProgressItem[] {
  const extra = raw.extra;
  if (!extra || typeof extra !== "object") {
    return [];
  }
  const payload = extra as Record<string, unknown>;
  const planType = resolveAccountPlanType(raw, payload);
  const isFreePlan = planType?.includes("free") ?? false;

  const fiveHourPercent = toOptionalNumber(payload.codex_5h_used_percent);
  const sevenDayPercent = toOptionalNumber(payload.codex_7d_used_percent);

  const items: ProgressItem[] = [];
  if (!isFreePlan && typeof fiveHourPercent === "number") {
    const usedPercent = normalizePercent(normalizePercentageLike(fiveHourPercent));
    const remainingPercent = normalizePercent(100 - usedPercent);
    items.push({
      key: "codex-5h",
      label: "5h",
      percentage: remainingPercent,
      text: `${formatPercent(remainingPercent)} 剩余`,
      resetText: formatResetHint(toStringValue(payload.codex_5h_reset_at)),
      tone: resolveRemainingTone(remainingPercent)
    });
  }
  if (typeof sevenDayPercent === "number") {
    const usedPercent = normalizePercent(normalizePercentageLike(sevenDayPercent));
    const remainingPercent = normalizePercent(100 - usedPercent);
    items.push({
      key: "codex-7d",
      label: "7d",
      percentage: remainingPercent,
      text: `${formatPercent(remainingPercent)} 剩余`,
      resetText: formatResetHint(toStringValue(payload.codex_7d_reset_at)),
      tone: resolveRemainingTone(remainingPercent)
    });
  }
  return items;
}

function buildQuotaProgressItems(raw: Record<string, unknown>): ProgressItem[] {
  const windows: Array<{
    key: string;
    label: string;
    usedKey: string;
    limitKey: string;
    resetKey?: string;
  }> = [
    {
      key: "quota-daily",
      label: "日",
      usedKey: "quota_daily_used",
      limitKey: "quota_daily_limit",
      resetKey: "quota_daily_reset_at"
    },
    {
      key: "quota-weekly",
      label: "周",
      usedKey: "quota_weekly_used",
      limitKey: "quota_weekly_limit",
      resetKey: "quota_weekly_reset_at"
    },
    {
      key: "quota-total",
      label: "总",
      usedKey: "quota_used",
      limitKey: "quota_limit"
    }
  ];

  const items: ProgressItem[] = [];
  for (const windowItem of windows) {
    const limit = toOptionalNumber(raw[windowItem.limitKey]);
    if (!limit || limit <= 0) {
      continue;
    }
    const used = toOptionalNumber(raw[windowItem.usedKey]) ?? 0;
    const usedPercent = normalizePercent((used / limit) * 100);
    const remainingPercent = normalizePercent(100 - usedPercent);
    const resetText = windowItem.resetKey
      ? formatResetHint(toStringValue(raw[windowItem.resetKey]))
      : undefined;
    items.push({
      key: windowItem.key,
      label: windowItem.label,
      percentage: remainingPercent,
      text: `${formatPercent(remainingPercent)} 剩余`,
      resetText,
      tone: resolveRemainingTone(remainingPercent)
    });
  }
  return items;
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

function resolveWindowResetIso(window: Record<string, unknown> | undefined): string | undefined {
  if (!window) {
    return undefined;
  }
  const resetAtRaw = window.reset_at ?? window.resetAt;
  const resetAtNumber = toOptionalNumber(resetAtRaw);
  if (typeof resetAtNumber === "number" && resetAtNumber > 0) {
    return new Date(resetAtNumber * 1000).toISOString();
  }
  const resetAtText = toStringValue(resetAtRaw);
  if (resetAtText) {
    return resetAtText;
  }
  const resetAfter = toOptionalNumber(
    window.reset_after_seconds ?? window.resetAfterSeconds
  );
  if (typeof resetAfter === "number" && resetAfter > 0) {
    return new Date(Date.now() + resetAfter * 1000).toISOString();
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

  // Legacy fallback: if upstream payload has no window size, use primary/secondary order.
  if (!fiveHourWindow && primaryWindow && primaryWindow !== weeklyWindow) {
    fiveHourWindow = primaryWindow;
  }
  if (!weeklyWindow && secondaryWindow && secondaryWindow !== fiveHourWindow) {
    weeklyWindow = secondaryWindow;
  }

  return {
    fiveHourWindow,
    weeklyWindow
  };
}

function buildCpaProgressItems(raw: Record<string, unknown>): ProgressItem[] {
  const status = (toStringValue(raw.status) ?? "").toLowerCase();
  const statusMessageText = toStringValue(raw.status_message);
  const nextRetryAfter = toStringValue(raw.next_retry_after);
  const healthyStatus =
    status === "active" || status === "normal" || status === "healthy" || status === "ok";

  let parsedStatusMessage: Record<string, unknown> | null = null;
  if (statusMessageText) {
    try {
      parsedStatusMessage = JSON.parse(statusMessageText) as Record<string, unknown>;
    } catch {
      parsedStatusMessage = null;
    }
  }

  const parsedError =
    parsedStatusMessage?.error && typeof parsedStatusMessage.error === "object"
      ? (parsedStatusMessage.error as Record<string, unknown>)
      : null;

  const errorType = (toStringValue(parsedError?.type) ?? "").toLowerCase();
  const errorMessage = (toStringValue(parsedError?.message) ?? "").toLowerCase();
  const resetAtUnix = toOptionalNumber(parsedError?.resets_at);
  const resetInSeconds = toOptionalNumber(parsedError?.resets_in_seconds);

  const sources: Record<string, unknown>[] = [raw];
  const usagePayload = toRecord(raw.cpa_quota_usage);
  if (usagePayload) {
    sources.push(usagePayload);
  }
  if (raw.extra && typeof raw.extra === "object") {
    sources.push(raw.extra as Record<string, unknown>);
  }
  if (parsedStatusMessage) {
    sources.push(parsedStatusMessage);
  }
  if (parsedError) {
    sources.push(parsedError);
  }

  let resetAtIso: string | undefined;
  if (typeof resetAtUnix === "number" && resetAtUnix > 0) {
    resetAtIso = new Date(resetAtUnix * 1000).toISOString();
  } else if (typeof resetInSeconds === "number" && resetInSeconds > 0) {
    resetAtIso = new Date(Date.now() + resetInSeconds * 1000).toISOString();
  } else {
    resetAtIso = nextRetryAfter;
  }

  if (usagePayload) {
    const officialItems: ProgressItem[] = [];
    const rateLimit = toRecord(usagePayload.rate_limit ?? usagePayload.rateLimit);

    const mainWindows = pickClassifiedWindows(rateLimit);
    const weeklyWindow = mainWindows.weeklyWindow;
    const weeklyUsed = getWindowUsedPercent(weeklyWindow, rateLimit);
    const weeklyWindowSeconds = getWindowSeconds(weeklyWindow);
    const hasExplicitWeeklyWindow = weeklyWindowSeconds === 604_800;
    if (typeof weeklyUsed === "number") {
      const remaining = normalizePercent(100 - weeklyUsed);
      const suspiciousZero = remaining <= 0 && healthyStatus && !hasExplicitWeeklyWindow;
      if (!suspiciousZero) {
        officialItems.push({
          key: "cpa-weekly-quota",
          label: "周限额",
          percentage: remaining,
          text:
            remaining <= 0
              ? "0% 剩余（已用尽）"
              : `${formatPercent(remaining)} 剩余`,
          resetText: formatResetHint(
            resolveWindowResetIso(mainWindows.weeklyWindow) ?? resetAtIso
          ),
          tone: resolveRemainingTone(remaining)
        });
      }
    }

    if (officialItems.length > 0) {
      return officialItems;
    }
  }

  const quotaExhausted =
    status.includes("quota_exhausted") ||
    status.includes("error") ||
    errorType.includes("usage_limit_reached") ||
    errorType.includes("insufficient_quota") ||
    errorMessage.includes("usage limit has been reached") ||
    errorMessage.includes("quota");

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
  const weeklyUsed = pickNumberFromSources(sources, [
    "codex_weekly_used_percent",
    "weekly_used_percent",
    "week_used_percent",
    "used_percent_weekly",
    "quota_weekly_used_percent"
  ]);
  const weeklyRemainingByText = pickPercentByRegex(
    statusMessageText,
    /(?:周限额|weekly)\D{0,12}(\d{1,3}(?:\.\d+)?)%/i
  );
  const weeklyRemaining =
    typeof weeklyRemainingDirect === "number"
      ? weeklyRemainingDirect
      : typeof weeklyUsed === "number"
      ? 100 - weeklyUsed
      : weeklyRemainingByText;

  const weeklyReset = pickStringFromSources(sources, [
    "codex_weekly_reset_at",
    "weekly_reset_at",
    "week_reset_at",
    "quota_weekly_reset_at"
  ]);

  const remainingItems: ProgressItem[] = [];
  if (typeof weeklyRemaining === "number") {
    const normalized = normalizePercent(weeklyRemaining);
    const suspiciousZero = normalized <= 0 && healthyStatus && !quotaExhausted;
    if (!suspiciousZero) {
      remainingItems.push({
        key: "cpa-weekly-quota",
        label: "周限额",
        percentage: normalized,
        text:
          normalized <= 0
            ? "0% 剩余（已用尽）"
            : `${formatPercent(normalized)} 剩余`,
        resetText: formatResetHint(weeklyReset ?? resetAtIso),
        tone: resolveRemainingTone(normalized)
      });
    }
  }
  if (remainingItems.length > 0) {
    return remainingItems;
  }

  if (quotaExhausted) {
    return [
      {
        key: "cpa-quota",
        label: "额度",
        percentage: 0,
        text: "0% 剩余（已用尽）",
        resetText: formatResetHint(resetAtIso),
        tone: "error"
      }
    ];
  }

  return [
    {
      key: "cpa-quota",
      label: "额度",
      percentage: 0,
      text: "可用（未返回上限）",
      resetText: formatResetHint(resetAtIso),
      tone: "success"
    }
  ];
}

const progressItems = computed<ProgressItem[]>(() => {
  if (!["sub2api", "cliproxyapi"].includes(props.account.platform)) {
    return [];
  }
  const raw =
    props.account.raw && typeof props.account.raw === "object"
      ? (props.account.raw as Record<string, unknown>)
      : null;
  if (!raw) {
    return [];
  }

  if (props.account.platform === "cliproxyapi") {
    return buildCpaProgressItems(raw);
  }

  const codexItems = buildCodexProgressItems(raw);
  const quotaItems = buildQuotaProgressItems(raw);
  return [...codexItems, ...quotaItems];
});
</script>

<template>
  <div v-if="progressItems.length" class="usage-progress-cell">
    <div v-for="item in progressItems" :key="item.key" class="usage-progress-row">
      <div class="usage-progress-meta">
        <span class="usage-progress-label">{{ item.label }}</span>
        <span class="usage-progress-value">
          {{ item.text }}
          <span v-if="item.resetText"> · {{ item.resetText }}</span>
        </span>
      </div>
      <div class="usage-progress-track">
        <div
          class="usage-progress-fill"
          :class="`usage-progress-fill--${item.tone}`"
          :style="buildFillStyle(item)"
        />
      </div>
    </div>
  </div>
  <span v-else class="usage-progress-empty">-</span>
</template>
