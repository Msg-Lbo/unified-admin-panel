<script setup lang="ts">
import { computed } from "vue";
import type { UnifiedAccount } from "../types/platform";
import type { QuotaCardMetrics } from "../utils/quotaCard";

const props = defineProps<{
  account: UnifiedAccount;
  metrics: QuotaCardMetrics;
}>();

const emit = defineEmits<{
  (event: "copy-email", email: string): void;
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
    normalized.includes("rate_limited") ||
    normalized.includes("rate limit")
  ) {
    return "额度用尽";
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

const statusTone = computed<"ok" | "warn" | "error">(() => {
  if (props.metrics.exhausted) {
    return "warn";
  }
  const normalized = props.account.status.trim().toLowerCase();
  if (
    normalized.includes("error") ||
    normalized.includes("invalid") ||
    normalized.includes("banned") ||
    normalized.includes("failed")
  ) {
    return "error";
  }
  if (
    normalized.includes("inactive") ||
    normalized.includes("disabled") ||
    normalized.includes("quota") ||
    normalized.includes("exhausted") ||
    normalized.includes("limit") ||
    normalized.includes("retry")
  ) {
    return "warn";
  }
  return "ok";
});

const statusLabel = computed(() => {
  if (props.metrics.exhausted) {
    return "额度用尽";
  }
  return normalizeStatusLabel(props.account.status);
});

const displayEmail = computed(() => props.account.email?.trim() || "-");
const planType = computed<PlanType>(() => resolvePlanTypeFromAccount(props.account));

const cardStyle = computed<Record<string, string>>(() => {
  if (props.metrics.exhausted) {
    return {
      background:
        "linear-gradient(145deg, rgba(20,24,35,0.98) 0%, rgba(12,16,28,0.98) 68%, rgba(6,8,16,0.98) 100%)"
    };
  }

  const usedPercent = Math.max(
    0,
    Math.min(
      100,
      props.metrics.usedPercent ??
        (typeof props.metrics.remainingPercent === "number"
          ? 100 - props.metrics.remainingPercent
          : 38)
    )
  );
  const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));

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
</script>

<template>
  <article
    class="account-card account-card--clickable"
    :class="{ 'account-card--exhausted': metrics.exhausted }"
    :style="cardStyle"
    role="button"
    tabindex="0"
    @click="handleCopyEmail"
    @keydown.enter.prevent="handleCopyEmail"
    @keydown.space.prevent="handleCopyEmail"
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
      </div>
    </header>

    <div class="account-card__quota">
      <div class="account-card__quota-row">
        <span>总额度</span>
        <strong>{{ metrics.totalText }}</strong>
      </div>
      <div class="account-card__quota-row">
        <span>已使用</span>
        <strong>{{ metrics.usedText }}</strong>
      </div>
    </div>
  </article>
</template>
