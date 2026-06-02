<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace
} from "naive-ui";
import type { PlatformKind, UnifiedAccount } from "../types/platform";

const props = defineProps<{
  showBatchEdit: boolean;
  showRename: boolean;
  accounts: UnifiedAccount[];
  renameMode: "single" | "batch";
  submitting: boolean;
}>();

const emit = defineEmits<{
  (event: "update:showBatchEdit", value: boolean): void;
  (event: "update:showRename", value: boolean): void;
  (
    event: "submit-batch-edit",
    payload: {
      priority?: number;
      note?: string;
      schedulable?: boolean;
    }
  ): void;
  (event: "submit-rename", payload: { name: string }): void;
}>();

const batchPriority = ref<number | null>(null);
const batchNote = ref("");
const batchSchedulable = ref<boolean | null>(null);
const renameName = ref("");

const platformKind = computed<PlatformKind | undefined>(() => props.accounts[0]?.platform);
const isSub2Api = computed(() => platformKind.value === "sub2api");
const isSingleRename = computed(() => props.renameMode === "single");
const batchTitle = computed(() => {
  const count = props.accounts.length;
  const label = platformKind.value === "sub2api" ? "Sub2API" : "CPA";
  return `批量编辑 ${label}（${count} 项）`;
});

const renameTitle = computed(() => {
  if (props.renameMode === "batch") {
    return `批量重命名为邮箱（${props.accounts.length} 项）`;
  }
  return "重命名账号";
});

const renameHint = computed(() => {
  if (props.renameMode === "batch") {
    return "将把选中账号的名称更新为 credentials.email；无邮箱的账号会跳过。";
  }
  return "可自定义账号显示名称，将调用官方更新接口写入。";
});

watch(
  () => props.showBatchEdit,
  (visible) => {
    if (!visible) {
      return;
    }
    batchPriority.value = null;
    batchNote.value = "";
    batchSchedulable.value = null;
  }
);

watch(
  () => [props.showRename, props.renameMode, props.accounts] as const,
  () => {
    if (!props.showRename) {
      return;
    }
    if (props.renameMode === "single") {
      renameName.value = props.accounts[0]?.name?.trim() ?? "";
      return;
    }
    renameName.value = "";
  },
  { deep: true }
);

function closeBatchEdit(): void {
  emit("update:showBatchEdit", false);
}

function closeRename(): void {
  emit("update:showRename", false);
}

function submitBatchEdit(): void {
  const payload: {
    priority?: number;
    note?: string;
    schedulable?: boolean;
  } = {};
  if (typeof batchPriority.value === "number" && Number.isFinite(batchPriority.value)) {
    payload.priority = Math.trunc(batchPriority.value);
  }
  const note = batchNote.value.trim();
  if (note) {
    payload.note = note;
  }
  if (typeof batchSchedulable.value === "boolean") {
    payload.schedulable = batchSchedulable.value;
  }
  if (!Object.keys(payload).length) {
    return;
  }
  emit("submit-batch-edit", payload);
}

function submitRename(): void {
  if (props.renameMode === "batch") {
    emit("submit-rename", { name: "" });
    return;
  }
  const name = renameName.value.trim();
  if (!name) {
    return;
  }
  emit("submit-rename", { name });
}
</script>

<template>
  <NModal
    :show="showBatchEdit"
    :mask-closable="false"
    preset="card"
    :title="batchTitle"
    style="width: min(520px, 92vw)"
    @update:show="(value) => emit('update:showBatchEdit', value)"
  >
    <NForm label-placement="top">
      <NFormItem label="优先级（留空不修改）">
        <NInputNumber
          v-model:value="batchPriority"
          :min="0"
          :max="9999"
          clearable
          style="width: 100%"
        />
      </NFormItem>
      <NFormItem :label="isSub2Api ? '备注 notes（留空不修改）' : '备注 note（留空不修改）'">
        <NInput
          v-model:value="batchNote"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          placeholder="批量写入相同备注"
        />
      </NFormItem>
      <NFormItem v-if="isSub2Api" label="可调度 schedulable（留空不修改）">
        <NSelect
          :value="
            batchSchedulable === null ? null : batchSchedulable ? 'enable' : 'disable'
          "
          clearable
          placeholder="不修改"
          :options="[
            { label: '启用调度', value: 'enable' },
            { label: '停用调度', value: 'disable' }
          ]"
          @update:value="
            (value) =>
              (batchSchedulable =
                value === 'enable' ? true : value === 'disable' ? false : null)
          "
        />
      </NFormItem>
    </NForm>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="closeBatchEdit">取消</NButton>
        <NButton type="primary" :loading="submitting" @click="submitBatchEdit">应用</NButton>
      </NSpace>
    </template>
  </NModal>

  <NModal
    :show="showRename"
    :mask-closable="false"
    preset="card"
    :title="renameTitle"
    style="width: min(480px, 92vw)"
    @update:show="(value) => emit('update:showRename', value)"
  >
    <p class="account-manage-modal__hint">{{ renameHint }}</p>
    <NForm v-if="isSingleRename" label-placement="top">
      <NFormItem label="新名称">
        <NInput v-model:value="renameName" placeholder="输入自定义名称" />
      </NFormItem>
    </NForm>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="closeRename">取消</NButton>
        <NButton type="primary" :loading="submitting" @click="submitRename">
          {{ renameMode === "batch" ? "确认批量重命名" : "保存" }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.account-manage-modal__hint {
  margin: 0 0 12px;
  color: var(--text-subtle);
  font-size: 0.86rem;
  line-height: 1.5;
}
</style>
