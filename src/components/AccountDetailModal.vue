<script setup lang="ts">
import {
  NAlert,
  NButton,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
  NTabPane,
  NTabs,
  type SelectOption
} from "naive-ui";
import type { UnifiedAccount } from "../types/platform";

const props = defineProps<{
  show: boolean;
  target: UnifiedAccount | null;
  loading: boolean;
  error: string;
  profileText: string;
  statsText: string;
  modelsText: string;
  refreshedAtText: string;
  autoRefresh: boolean;
  refreshSeconds: number;
  refreshOptions: SelectOption[];
}>();

function formatStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (
    normalized.includes("quota_exhausted") ||
    normalized.includes("usage_limit_reached")
  ) {
    return "额度用尽";
  }
  if (normalized === "active") {
    return "正常";
  }
  if (normalized === "disabled") {
    return "停用";
  }
  return status;
}

const emit = defineEmits<{
  (event: "update:show", value: boolean): void;
  (event: "refresh"): void;
  (event: "update:autoRefresh", value: boolean): void;
  (event: "update:refreshSeconds", value: number): void;
}>();
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="账号详情"
    style="width: min(1080px, 96vw)"
    @update:show="(value) => emit('update:show', value)"
  >
    <div v-if="target" class="detail-header">
      <div>
        <h3>{{ target.name }}</h3>
        <p>
          {{ target.platformName }} · {{ target.accountId }} ·
          {{ formatStatusLabel(target.status) }}
        </p>
        <p v-if="props.target?.statusDetail">{{ props.target.statusDetail }}</p>
        <p>最近刷新：{{ refreshedAtText }}</p>
      </div>
      <NSpace>
        <NButton :loading="loading" @click="emit('refresh')">
          刷新详情
        </NButton>
        <NSwitch
          :value="autoRefresh"
          @update:value="(value) => emit('update:autoRefresh', value)"
        >
          <template #checked>自动</template>
          <template #unchecked>手动</template>
        </NSwitch>
        <NSelect
          :value="refreshSeconds"
          :options="refreshOptions"
          :disabled="!autoRefresh"
          style="width: 95px"
          @update:value="(value) => emit('update:refreshSeconds', value)"
        />
      </NSpace>
    </div>

    <NAlert v-if="error" type="error" class="error-alert">
      {{ error }}
    </NAlert>

    <NTabs type="line">
      <NTabPane name="profile" tab="资料">
        <pre class="raw-json">{{ profileText }}</pre>
      </NTabPane>
      <NTabPane name="stats" tab="用量统计">
        <pre class="raw-json">{{ statsText }}</pre>
      </NTabPane>
      <NTabPane name="models" tab="模型列表">
        <pre class="raw-json">{{ modelsText }}</pre>
      </NTabPane>
    </NTabs>
  </NModal>
</template>
