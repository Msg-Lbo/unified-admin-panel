<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { UnifiedAccount } from "../types/platform";
import type { QuotaCardMetrics, UsageWindowMetric } from "../utils/quotaCard";

const props = defineProps<{
  account: UnifiedAccount;
  metrics: QuotaCardMetrics;
  selectionMode?: boolean;
  selected?: boolean;
}>();

const emit = defineEmits<{
  (event: "copy-email", email: string): void;
  (
    event: "open-context-menu",
    payload: { account: UnifiedAccount; x: number; y: number }
  ): void;
  (event: "toggle-select", uid: string): void;
}>();

type PlanType = "free" | "plus" | "team" | "pro" | "unknown";

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
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
    return "额度用尽";
  }
  if (
    normalized.includes("banned") ||
    normalized.includes("deactivated") ||
    normalized.includes("account_deactivated")
  ) {
    return "封禁";
  }
  if (normalized === "active") {
    return "正常";
  }
  if (normalized === "inactive" || normalized === "disabled") {
    return "停用";
  }
  if (normalized === "error") {
    return "异常";
  }
  return status;
}

function isQuotaExhaustedStatus(status: string): boolean {
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

function hasClearRemainingQuota(metrics: QuotaCardMetrics): boolean {
  return (
    (typeof metrics.usedPercent === "number" && metrics.usedPercent < 99.95) ||
    (typeof metrics.remainingPercent === "number" && metrics.remainingPercent > 0.05)
  );
}

function normalizeAuthTypeLabel(rawType: string): string {
  const value = rawType.trim().toLowerCase();
  if (!value || value === "unknown") {
    return "unknown";
  }
  if (value.includes("oauth")) {
    return "oauth";
  }
  if (value.includes("openai")) {
    return "openai";
  }
  if (value.includes("anthropic") || value.includes("claude")) {
    return "claude";
  }
  return value;
}

function normalizePlanType(rawType: string): PlanType {
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

function resolvePlanTypeFromAccount(account: UnifiedAccount): PlanType {
  const raw = toRecord(account.raw);
  const credentials = toRecord(raw?.credentials);
  const extra = toRecord(raw?.extra);

  const candidates: string[] = [];
  for (const candidate of [
    credentials?.plan_type,
    credentials?.planType,
    credentials?.chatgpt_plan_type,
    credentials?.chatgptPlanType,
    raw?.plan_type,
    raw?.planType,
    raw?.subscription_plan,
    raw?.subscriptionPlan,
    extra?.plan_type,
    extra?.planType
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      candidates.push(candidate);
    }
  }

  for (const candidate of candidates) {
    const planType = normalizePlanType(candidate);
    if (planType !== "unknown") {
      return planType;
    }
  }
  return "unknown";
}

function formatPercent(value: number): string {
  const normalized = Math.max(0, Math.min(100, value));
  if (normalized >= 100) {
    return `${Math.round(normalized)}%`;
  }
  return `${normalized.toFixed(1)}%`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

const statusTone = computed<"ok" | "exhausted" | "error" | "banned" | "disabled">(() => {
  const normalized = props.account.status.trim().toLowerCase();
  if (
    normalized.includes("banned") ||
    normalized.includes("deactivated") ||
    normalized.includes("account_deactivated")
  ) {
    return "banned";
  }
  if (props.metrics.exhausted) {
    return "exhausted";
  }
  if (
    normalized.includes("inactive") ||
    normalized.includes("disabled")
  ) {
    return "disabled";
  }
  if (
    isQuotaExhaustedStatus(normalized) ||
    normalized.includes("exhausted")
  ) {
    if (hasClearRemainingQuota(props.metrics)) {
      return "error";
    }
    return "exhausted";
  }
  if (
    normalized.includes("error") ||
    normalized.includes("invalid") ||
    normalized.includes("failed")
  ) {
    return "error";
  }
  return "ok";
});

const statusLabel = computed(() => {
  const normalized = props.account.status.trim().toLowerCase();
  if (
    normalized.includes("banned") ||
    normalized.includes("deactivated") ||
    normalized.includes("account_deactivated")
  ) {
    return "封禁";
  }
  if (props.metrics.exhausted) {
    return "额度用尽";
  }
  const normalizedLabel = normalizeStatusLabel(props.account.status);
  if (normalizedLabel === "额度用尽" && hasClearRemainingQuota(props.metrics)) {
    return "异常";
  }
  return normalizedLabel;
});

const displayEmail = computed(() => {
  const direct = props.account.email?.trim();
  if (direct) {
    return direct;
  }
  const raw = toRecord(props.account.raw);
  const credentials = toRecord(raw?.credentials);
  const nestedEmail =
    typeof credentials?.email === "string" ? credentials.email.trim() : "";
  return nestedEmail || "";
});

const displayName = computed(() => {
  const name = props.account.name?.trim();
  if (name && name !== "-") {
    return name;
  }
  if (displayEmail.value) {
    return displayEmail.value;
  }
  return props.account.accountId?.trim() || "-";
});

const rowPrimaryText = computed(() => displayEmail.value || displayName.value);

const authTypeLabel = computed(() => normalizeAuthTypeLabel(props.account.type));
const planType = computed<PlanType>(() => resolvePlanTypeFromAccount(props.account));
const usageWindows = computed(() => props.metrics.usageWindows ?? []);
const isUpdating = ref(false);

function formatWindowUsed(item: UsageWindowMetric): string {
  if (typeof item.usedPercent === "number") {
    return formatPercent(item.usedPercent);
  }
  return "-";
}

function formatWindowAmount(item: UsageWindowMetric): string {
  const value =
    typeof item.usedUsdValue === "number" && Number.isFinite(item.usedUsdValue)
      ? item.usedUsdValue
      : 0;
  return formatUsd(value);
}

function windowRemainingPercent(item: UsageWindowMetric): number {
  if (typeof item.remainingPercent === "number") {
    return Math.max(0, Math.min(100, item.remainingPercent));
  }
  if (typeof item.usedPercent === "number") {
    return Math.max(0, Math.min(100, 100 - item.usedPercent));
  }
  return 0;
}

function windowProgressStyle(item: UsageWindowMetric): Record<string, string> {
  const remaining = windowRemainingPercent(item);
  if (remaining <= 0) {
    return {
      width: "0%",
      background: "transparent"
    };
  }
  const main = colorForRemainingPercent(remaining);
  const edge = colorForRemainingPercent(Math.max(0, remaining - 8));
  return {
    width: `${remaining}%`,
    background: `linear-gradient(90deg, ${main} 0%, ${edge} 100%)`
  };
}

const resolvedUsedPercent = computed(() =>
  Math.max(
    0,
    Math.min(
      100,
      props.metrics.usedPercent ??
        (typeof props.metrics.remainingPercent === "number"
          ? 100 - props.metrics.remainingPercent
          : 0)
    )
  )
);

const hasProgressMetric = computed(
  () =>
    typeof props.metrics.remainingPercent === "number" ||
    typeof props.metrics.usedPercent === "number"
);

const resolvedRemainingPercent = computed(() => {
  if (!hasProgressMetric.value) {
    return 0;
  }
  if (typeof props.metrics.remainingPercent === "number") {
    return Math.max(0, Math.min(100, props.metrics.remainingPercent));
  }
  return Math.max(0, Math.min(100, 100 - resolvedUsedPercent.value));
});

function colorForRemainingPercent(remaining: number): string {
  const ratio = Math.max(0, Math.min(1, remaining / 100));
  const hue = ratio * 88;
  return `hsl(${hue.toFixed(1)} 78% 46%)`;
}

const progressFillStyle = computed(() => {
  const remaining = resolvedRemainingPercent.value;
  if (remaining <= 0) {
    return {
      width: "0%",
      background: "transparent"
    };
  }
  const main = colorForRemainingPercent(remaining);
  const edge = colorForRemainingPercent(Math.max(0, remaining - 8));
  return {
    width: `${remaining}%`,
    background: `linear-gradient(90deg, ${main} 0%, ${edge} 100%)`
  };
});

const usageAmountText = computed(() => {
  if (
    typeof props.metrics.usedUsdValue === "number" &&
    Number.isFinite(props.metrics.usedUsdValue)
  ) {
    return formatUsd(props.metrics.usedUsdValue);
  }
  const fallback = props.metrics.usedText?.trim();
  if (!fallback || fallback === "-") {
    return "";
  }
  const usdMatch = fallback.match(/\$[\d,.]+/);
  if (usdMatch) {
    return usdMatch[0];
  }
  if (!fallback.includes("%")) {
    return fallback;
  }
  return "";
});

const showUsageRows = computed(
  () =>
    planType.value !== "unknown" &&
    (usageWindows.value.length > 0 ||
      Boolean(usageAmountText.value) ||
      hasProgressMetric.value)
);

const showFallbackUsageRow = computed(
  () => !usageWindows.value.length && (Boolean(usageAmountText.value) || hasProgressMetric.value)
);

function shouldShowWindowProgress(window: UsageWindowMetric["window"]): boolean {
  return window === "5h" || window === "7d";
}

const metricSignature = computed(() => {
  const windows = (props.metrics.usageWindows ?? [])
    .map(
      (item) =>
        `${item.window}:${item.usedPercent ?? ""}:${item.remainingPercent ?? ""}:${item.resetAtLabel ?? ""}:${item.usedUsdValue ?? ""}`
    )
    .join("|");
  return `${props.metrics.totalText}|${props.metrics.usedText}|${props.metrics.totalUsdValue ?? ""}|${props.metrics.usedUsdValue ?? ""}|${props.metrics.remainingPercent ?? ""}|${props.metrics.usedPercent ?? ""}|${windows}|${props.metrics.exhausted ? "1" : "0"}`;
});

let mountedOnce = false;
let updateTimer: ReturnType<typeof setTimeout> | null = null;

watch(metricSignature, () => {
  if (!mountedOnce) {
    mountedOnce = true;
    return;
  }
  isUpdating.value = true;
  if (updateTimer) {
    clearTimeout(updateTimer);
  }
  updateTimer = setTimeout(() => {
    isUpdating.value = false;
  }, 520);
});

onBeforeUnmount(() => {
  if (updateTimer) {
    clearTimeout(updateTimer);
  }
});

function handleCopyEmail(): void {
  if (!displayEmail.value) {
    return;
  }
  emit("copy-email", displayEmail.value);
}

function handleToggleSelect(event: Event): void {
  event.stopPropagation();
  emit("toggle-select", props.account.uid);
}

function handleRowClick(): void {
  if (props.selectionMode) {
    emit("toggle-select", props.account.uid);
    return;
  }
  handleCopyEmail();
}

function handleContextMenu(event: MouseEvent): void {
  emit("open-context-menu", {
    account: props.account,
    x: event.clientX,
    y: event.clientY
  });
}
</script>

<template>
  <article
    class="account-row account-row--clickable"
    :class="{
      'account-row--exhausted': metrics.exhausted,
      'account-row--updating': isUpdating,
      'account-row--selected': selected
    }"
    role="button"
    tabindex="0"
    @click="handleRowClick"
    @keydown.enter.prevent="handleRowClick"
    @keydown.space.prevent="handleRowClick"
    @contextmenu.prevent="handleContextMenu"
  >
    <div class="account-row__line1">
      <label
        v-if="selectionMode"
        class="account-row__select"
        @click.stop
        @keydown.stop
      >
        <input
          type="checkbox"
          class="account-row__select-input"
          :checked="selected"
          @change="handleToggleSelect"
        />
      </label>
      <p class="account-row__email-primary" :title="rowPrimaryText">{{ rowPrimaryText }}</p>
      <div class="account-row__tags">
        <span class="account-row__status" :class="`account-row__status--${statusTone}`">
          {{ statusLabel }}
        </span>
        <span
          class="account-row__auth-type"
          :class="`account-row__auth-type--${authTypeLabel === 'unknown' ? 'unknown' : 'known'}`"
        >
          {{ authTypeLabel }}
        </span>
        <span class="account-row__type" :class="`account-row__type--${planType}`">
          {{ planType }}
        </span>
      </div>
    </div>

    <div v-if="showUsageRows" class="account-row__windows">
      <div
        v-for="item in usageWindows"
        :key="item.window"
        class="account-row__window"
      >
        <div class="account-row__window-meta">
          <span class="account-row__window-label">{{ item.window }}</span>
          <span class="account-row__window-percent">{{ formatWindowUsed(item) }}</span>
          <span
            v-if="item.resetAtLabel"
            class="account-row__window-reset"
            :title="item.resetAt ? `下次刷新：${item.resetAt}` : undefined"
          >
            刷新 {{ item.resetAtLabel }}
          </span>
          <span
            v-if="shouldShowWindowProgress(item.window)"
            class="account-row__window-amount"
          >
            {{ formatWindowAmount(item) }}
          </span>
        </div>
        <div
          v-if="shouldShowWindowProgress(item.window)"
          class="account-row__window-progress"
          role="progressbar"
          :aria-valuenow="windowRemainingPercent(item)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`${item.window} 剩余额度`"
        >
          <div
            v-if="windowRemainingPercent(item) > 0"
            class="account-row__window-progress-fill"
            :style="windowProgressStyle(item)"
          />
        </div>
      </div>

      <div v-if="showFallbackUsageRow" class="account-row__window">
        <div class="account-row__window-meta">
          <span class="account-row__window-label">已用</span>
          <span v-if="usageAmountText" class="account-row__window-amount">{{ usageAmountText }}</span>
        </div>
        <div
          v-if="hasProgressMetric"
          class="account-row__window-progress"
          role="progressbar"
          :aria-valuenow="resolvedRemainingPercent"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-label="剩余额度"
        >
          <div
            v-if="resolvedRemainingPercent > 0"
            class="account-row__window-progress-fill"
            :style="progressFillStyle"
          />
        </div>
      </div>
    </div>
  </article>
</template>
