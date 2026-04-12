<script setup lang="ts">
import {
  NButton,
  NCheckbox,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSpace
} from "naive-ui";

defineProps<{
  show: boolean;
  saving: boolean;
  selectedCount: number;
  applyNote: boolean;
  applyPriority: boolean;
  note: string;
  priorityText: string;
}>();

const emit = defineEmits<{
  (event: "update:show", value: boolean): void;
  (event: "update:applyNote", value: boolean): void;
  (event: "update:applyPriority", value: boolean): void;
  (event: "update:note", value: string): void;
  (event: "update:priorityText", value: string): void;
  (event: "save"): void;
}>();
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    title="批量编辑字段"
    style="width: min(700px, 95vw)"
    @update:show="(value) => emit('update:show', value)"
  >
    <NForm label-placement="top">
      <NFormItem>
        <NCheckbox
          :checked="applyNote"
          @update:checked="(value) => emit('update:applyNote', value)"
        >
          应用备注（sub2api 批量接口不支持备注，会自动跳过）
        </NCheckbox>
      </NFormItem>
      <NFormItem label="备注">
        <NInput
          :value="note"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :disabled="!applyNote"
          @update:value="(value) => emit('update:note', value)"
        />
      </NFormItem>
      <NFormItem>
        <NCheckbox
          :checked="applyPriority"
          @update:checked="(value) => emit('update:applyPriority', value)"
        >
          应用优先级
        </NCheckbox>
      </NFormItem>
      <NFormItem label="优先级">
        <NInput
          :value="priorityText"
          placeholder="非负整数"
          :disabled="!applyPriority"
          @update:value="(value) => emit('update:priorityText', value)"
        />
      </NFormItem>
    </NForm>
    <NSpace justify="space-between" align="center">
      <span class="selection-count">
        目标账号：{{ selectedCount }}
      </span>
      <NSpace>
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :loading="saving" @click="emit('save')">
          应用
        </NButton>
      </NSpace>
    </NSpace>
  </NModal>
</template>
