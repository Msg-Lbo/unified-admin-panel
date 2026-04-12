<script setup lang="ts">
import { NCard, NGrid, NGridItem } from "naive-ui";
import type { PlatformQuotaSummary } from "../types/platform";

const props = defineProps<{
  summaries: PlatformQuotaSummary[];
}>();

function normalizePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function formatPercent(value?: number): string {
  if (typeof value !== "number") {
    return "-";
  }
  return `${normalizePercent(value).toFixed(1)}%`;
}

function formatUsd(value?: number): string {
  if (typeof value !== "number") {
    return "-";
  }
  return `$${value.toFixed(2)}`;
}

function formatTokens(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return Math.max(0, Math.round(value)).toLocaleString();
}

function getRemainingHue(remainingPercent: number): number {
  const clamped = normalizePercent(remainingPercent);
  return Math.round((clamped / 100) * 165);
}

function buildFillStyle(percent?: number): Record<string, string> {
  const normalized = normalizePercent(percent ?? 0);
  const hue = getRemainingHue(normalized);
  const start = `hsl(${Math.min(180, hue + 12)}, 86%, 48%)`;
  const end = `hsl(${Math.max(0, hue - 8)}, 78%, 41%)`;
  return {
    width: `${normalized}%`,
    background: `linear-gradient(90deg, ${start}, ${end})`
  };
}

function getPrimaryLabel(summary: PlatformQuotaSummary): string {
  if (typeof summary.totalRemainingUsd === "number") {
    return "剩余额度";
  }
  if (typeof summary.totalEstimatedRemainingUsd === "number") {
    return "估算剩余";
  }
  if (typeof summary.totalEstimatedUsedUsd === "number") {
    return "估算已用";
  }
  return "平均剩余";
}

function getPrimaryValue(summary: PlatformQuotaSummary): string {
  if (typeof summary.totalRemainingUsd === "number") {
    return formatUsd(summary.totalRemainingUsd);
  }
  if (typeof summary.totalEstimatedRemainingUsd === "number") {
    return formatUsd(summary.totalEstimatedRemainingUsd);
  }
  if (typeof summary.totalEstimatedUsedUsd === "number") {
    return formatUsd(summary.totalEstimatedUsedUsd);
  }
  return formatPercent(summary.averageRemainingPercent);
}

function getMetaHint(summary: PlatformQuotaSummary): string {
  if (typeof summary.totalRemainingUsd === "number") {
    return "按美元剩余额度统计";
  }
  if (typeof summary.totalEstimatedRemainingUsd === "number") {
    return "按剩余百分比与已用美元估算";
  }
  if (typeof summary.totalEstimatedUsedUsd === "number") {
    return "按 Token 与官方单价估算";
  }
  return "按剩余百分比统计";
}
</script>

<template>
  <NGrid :cols="'1 s:1 m:2 l:2'" responsive="screen" :x-gap="16" :y-gap="16">
    <NGridItem v-for="summary in props.summaries" :key="summary.platform">
      <NCard size="small" class="panel-card quota-summary-card">
        <div class="quota-summary-card__head">
          <p class="quota-summary-card__title">{{ summary.label }} 额度总览</p>
          <p class="quota-summary-card__primary">{{ getPrimaryValue(summary) }}</p>
        </div>

        <p class="quota-summary-card__meta">
          {{ getPrimaryLabel(summary) }} · 可统计账号 {{ summary.measurableCount }} /
          {{ summary.accountCount }} · {{ getMetaHint(summary) }}
        </p>

        <p
          v-if="
            typeof summary.totalEstimatedRemainingUsd === 'number' &&
            typeof summary.totalRemainingUsd !== 'number'
          "
          class="quota-summary-card__meta"
        >
          估算剩余：{{ formatUsd(summary.totalEstimatedRemainingUsd) }}
        </p>

        <p
          v-if="typeof summary.totalEstimatedUsedUsd === 'number'"
          class="quota-summary-card__meta"
        >
          估算已用：{{ formatUsd(summary.totalEstimatedUsedUsd) }}
        </p>

        <p
          v-if="typeof summary.totalTransferredTokens === 'number'"
          class="quota-summary-card__meta"
        >
          总共传送：{{ formatTokens(summary.totalTransferredTokens) }} Token
        </p>

        <div class="quota-summary-card__track">
          <div
            class="quota-summary-card__fill"
            :style="buildFillStyle(summary.averageRemainingPercent)"
          />
        </div>
      </NCard>
    </NGridItem>
  </NGrid>
</template>
