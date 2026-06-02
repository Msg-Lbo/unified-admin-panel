<script setup lang="ts">
import { computed, watch, ref } from "vue";
import { NButton, NModal, NSpace } from "naive-ui";
import JsonFoldViewer from "./JsonFoldViewer.vue";
import type { UnifiedAccount } from "../types/platform";

const props = defineProps<{
  show: boolean;
  account: UnifiedAccount | null;
}>();

const emit = defineEmits<{
  (event: "update:show", value: boolean): void;
}>();

const modalTitle = computed(() => {
  const account = props.account;
  if (!account) {
    return "账号 JSON";
  }
  const label = account.email?.trim() || account.name?.trim() || account.accountId;
  return `账号 JSON · ${label}`;
});

const jsonPayload = computed(() => {
  if (!props.account) {
    return null;
  }
  return {
    uid: props.account.uid,
    platform: props.account.platform,
    platformName: props.account.platformName,
    accountId: props.account.accountId,
    manageKey: props.account.manageKey,
    name: props.account.name,
    type: props.account.type,
    status: props.account.status,
    statusDetail: props.account.statusDetail,
    email: props.account.email,
    note: props.account.note,
    priority: props.account.priority,
    updatedAt: props.account.updatedAt,
    raw: props.account.raw
  };
});

const jsonText = computed(() => {
  if (!jsonPayload.value) {
    return "";
  }
  return JSON.stringify(jsonPayload.value, null, 2);
});

const viewerKey = ref(0);

watch(
  () => props.account?.uid,
  () => {
    viewerKey.value += 1;
  }
);

function closeModal(): void {
  emit("update:show", false);
}

async function copyJson(): Promise<void> {
  if (!jsonText.value) {
    return;
  }
  await navigator.clipboard.writeText(jsonText.value);
}
</script>

<template>
  <NModal
    :show="show"
    :mask-closable="true"
    preset="card"
    :title="modalTitle"
    class="account-json-modal"
    :style="{ width: 'min(760px, 92vw)', maxHeight: '92vh' }"
    :content-style="{ overflow: 'hidden', padding: '12px 16px 8px' }"
    @update:show="(value) => emit('update:show', value)"
  >
    <JsonFoldViewer v-if="jsonPayload" :key="viewerKey" :value="jsonPayload" />
    <template #footer>
      <NSpace justify="end">
        <NButton @click="closeModal">关闭</NButton>
        <NButton type="primary" :disabled="!jsonText" @click="copyJson">复制 JSON</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style>
.account-json-modal .n-card {
  max-height: 92vh;
  display: flex;
  flex-direction: column;
}

.account-json-modal .n-card__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.account-json-modal .n-card__footer {
  flex-shrink: 0;
}
</style>
