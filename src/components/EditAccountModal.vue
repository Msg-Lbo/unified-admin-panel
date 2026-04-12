<script setup lang="ts">
import {
  NButton,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSpace
} from "naive-ui";

defineProps<{
  show: boolean;
  supportsName: boolean;
  name: string;
  note: string;
  priorityText: string;
  saving: boolean;
}>();

const emit = defineEmits<{
  (event: "update:show", value: boolean): void;
  (event: "update:name", value: string): void;
  (event: "update:note", value: string): void;
  (event: "update:priorityText", value: string): void;
  (event: "save"): void;
}>();
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="编辑账号字段"
    style="width: min(640px, 94vw)"
    @update:show="(value) => emit('update:show', value)"
  >
    <NForm label-placement="top">
      <NFormItem v-if="supportsName" label="名称">
        <NInput
          :value="name"
          placeholder="账号显示名称"
          @update:value="(value) => emit('update:name', value)"
        />
      </NFormItem>
      <NFormItem label="备注">
        <NInput
          :value="note"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          placeholder="可选备注"
          @update:value="(value) => emit('update:note', value)"
        />
      </NFormItem>
      <NFormItem label="优先级">
        <NInput
          :value="priorityText"
          placeholder="可选整数，例如 100"
          @update:value="(value) => emit('update:priorityText', value)"
        />
      </NFormItem>
    </NForm>
    <NSpace justify="end">
      <NButton @click="emit('update:show', false)">取消</NButton>
      <NButton type="primary" :loading="saving" @click="emit('save')">
        保存
      </NButton>
    </NSpace>
  </NModal>
</template>
