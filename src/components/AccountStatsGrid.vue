<script setup lang="ts">
import { NCard, NGrid, NGridItem } from "naive-ui";

const props = defineProps<{
  total: number;
  healthy: number;
  warning: number;
  error: number;
  totalTransferredTokens?: number;
}>();

function formatTokens(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return `${Math.max(0, Math.round(value)).toLocaleString()} Token`;
}
</script>

<template>
  <NGrid :cols="'2 s:2 m:3 l:5'" responsive="screen" :x-gap="16" :y-gap="16">
    <NGridItem>
      <NCard size="small" class="stat-card">
        <p class="stat-card__label">账号总数</p>
        <p class="stat-card__value">{{ props.total }}</p>
      </NCard>
    </NGridItem>
    <NGridItem>
      <NCard size="small" class="stat-card">
        <p class="stat-card__label">健康</p>
        <p class="stat-card__value">{{ props.healthy }}</p>
      </NCard>
    </NGridItem>
    <NGridItem>
      <NCard size="small" class="stat-card">
        <p class="stat-card__label">警告</p>
        <p class="stat-card__value">{{ props.warning }}</p>
      </NCard>
    </NGridItem>
    <NGridItem>
      <NCard size="small" class="stat-card">
        <p class="stat-card__label">异常</p>
        <p class="stat-card__value">{{ props.error }}</p>
      </NCard>
    </NGridItem>
    <NGridItem>
      <NCard size="small" class="stat-card">
        <p class="stat-card__label">总共传送</p>
        <p class="stat-card__value stat-card__value--compact">
          {{ formatTokens(props.totalTransferredTokens) }}
        </p>
      </NCard>
    </NGridItem>
  </NGrid>
</template>
