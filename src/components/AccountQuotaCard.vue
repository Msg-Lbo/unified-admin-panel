<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { UnifiedAccount } from "../types/platform";
import type { QuotaCardMetrics } from "../utils/quotaCard";

const props = defineProps<{
  account: UnifiedAccount;
  metrics: QuotaCardMetrics;
  markHighest?: boolean;
  markLowest?: boolean;
}>();

const emit = defineEmits<{
  (event: "copy-email", email: string): void;
  (
    event: "open-context-menu",
    payload: { account: UnifiedAccount; x: number; y: number }
  ): void;
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
    normalized.includes("insufficient quota")
  ) {
    return "额度用尽";
  }
  if (
    normalized.includes("rate_limited") ||
    normalized.includes("rate limit") ||
    normalized.includes("ratelimited") ||
    normalized.includes("retry")
  ) {
    return "限流";
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
    extra?.planType,
    account.type,
    account.name,
    account.accountId
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
    normalized.includes("rate_limited") ||
    normalized.includes("rate limit") ||
    normalized.includes("ratelimited") ||
    normalized.includes("retry")
  ) {
    return "error";
  }
  if (
    normalized.includes("quota_exhausted") ||
    normalized.includes("usage_limit_reached") ||
    normalized.includes("insufficient_quota") ||
    normalized.includes("quota exhausted") ||
    normalized.includes("insufficient quota") ||
    normalized.includes("exhausted")
  ) {
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
  return normalizeStatusLabel(props.account.status);
});

const displayEmail = computed(() => props.account.email?.trim() || "-");
const planType = computed<PlanType>(() => resolvePlanTypeFromAccount(props.account));
const isUpdating = ref(false);
const isBackgroundLowering = ref(false);

const resolvedUsedPercent = computed(() =>
  Math.max(
    0,
    Math.min(
      100,
      props.metrics.usedPercent ??
        (typeof props.metrics.remainingPercent === "number"
          ? 100 - props.metrics.remainingPercent
          : 38)
    )
  )
);

const resolvedRemainingPercent = computed(() =>
  Math.max(0, Math.min(100, 100 - resolvedUsedPercent.value))
);

const unifiedUsedDisplayText = computed(() => {
  const percent =
    typeof props.metrics.usedPercent === "number"
      ? formatPercent(props.metrics.usedPercent)
      : undefined;
  const usedUsd = props.metrics.usedUsdValue;
  const totalUsd = props.metrics.totalUsdValue;

  if (percent) {
    const usedText =
      typeof usedUsd === "number" && Number.isFinite(usedUsd) ? formatUsd(usedUsd) : "-";
    const totalText =
      typeof totalUsd === "number" && Number.isFinite(totalUsd) && totalUsd > 0
        ? formatUsd(totalUsd)
        : "-";
    return `${percent}(${usedText}/${totalText})`;
  }

  const fallback = props.metrics.usedText?.trim();
  return fallback && fallback.length > 0 ? fallback : "-";
});

const metricSignature = computed(
  () =>
    `${props.metrics.totalText}|${props.metrics.usedText}|${props.metrics.totalUsdValue ?? ""}|${props.metrics.usedUsdValue ?? ""}|${props.metrics.remainingPercent ?? ""}|${props.metrics.usedPercent ?? ""}|${props.metrics.exhausted ? "1" : "0"}`
);

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

watch(resolvedRemainingPercent, (next, previous) => {
  if (typeof previous !== "number") {
    return;
  }
  isBackgroundLowering.value = next < previous;
});

onBeforeUnmount(() => {
  if (updateTimer) {
    clearTimeout(updateTimer);
  }
});

const cardStyle = computed<Record<string, string>>(() => {
  if (props.metrics.exhausted) {
    return {
      background:
        "linear-gradient(145deg, rgba(20,24,35,0.98) 0%, rgba(12,16,28,0.98) 68%, rgba(6,8,16,0.98) 100%)"
    };
  }

  const remainingPercent = resolvedRemainingPercent.value;

  return {
    background: `
      linear-gradient(
        90deg,
        rgba(56,189,248,0.46) 0%,
        rgba(15,118,110,0.4) ${remainingPercent}%,
        rgba(9,17,35,0.96) ${remainingPercent}%,
        rgba(9,17,35,0.96) 100%
      ),
      linear-gradient(
        140deg,
        rgba(10,17,40,0.96) 0%,
        rgba(17,33,64,0.96) 62%,
        rgba(12,26,48,0.96) 100%
      )
    `
  };
});

function handleCopyEmail(): void {
  if (displayEmail.value === "-") {
    return;
  }
  emit("copy-email", displayEmail.value);
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
    class="account-card account-card--clickable"
    :class="{
      'account-card--exhausted': metrics.exhausted,
      'account-card--updating': isUpdating,
      'account-card--background-lowering': isBackgroundLowering,
      'account-card--mark-highest': markHighest,
      'account-card--mark-lowest': markLowest
    }"
    :style="cardStyle"
    role="button"
    tabindex="0"
    @click="handleCopyEmail"
    @keydown.enter.prevent="handleCopyEmail"
    @keydown.space.prevent="handleCopyEmail"
    @contextmenu.prevent="handleContextMenu"
  >
    <header class="account-card__head">
      <p class="account-card__email">{{ displayEmail }}</p>
      <div class="account-card__tags">
        <span class="account-card__status" :class="`account-card__status--${statusTone}`">
          {{ statusLabel }}
        </span>
        <span class="account-card__type" :class="`account-card__type--${planType}`">
          {{ planType }}
        </span>
        <span v-if="markHighest" class="account-card__mark account-card__mark--highest">
          最高
        </span>
        <span v-if="markLowest" class="account-card__mark account-card__mark--lowest">
          最低
        </span>
      </div>
    </header>

    <div class="account-card__quota">
      <div class="account-card__quota-row">
        <span>已使用</span>
        <strong>{{ unifiedUsedDisplayText }}</strong>
      </div>
    </div>
  </article>
</template>

