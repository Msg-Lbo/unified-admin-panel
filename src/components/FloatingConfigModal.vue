<script setup lang="ts">
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NModal,
  NSelect,
  NSpace,
  NSwitch
} from "naive-ui";
import type { PlatformConfig, PlatformKind } from "../types/platform";
import type {
  PlatformSortSettings,
  SortDirection,
  SortField
} from "../types/viewSettings";

type EditableKey = "baseUrl" | "apiKey" | "enabled";

const props = defineProps<{
  show: boolean;
  platforms: PlatformConfig[];
  testLoading: Record<PlatformKind, boolean>;
  checkMessages: Record<PlatformKind, string>;
  sortSettings: PlatformSortSettings;
}>();

const emit = defineEmits<{
  (event: "update:show", value: boolean): void;
  (
    event: "update-platform-field",
    payload: { platformId: PlatformKind; key: EditableKey; value: string | boolean }
  ): void;
  (
    event: "update-sort-setting",
    payload: {
      platformId: PlatformKind;
      key: "field" | "direction";
      value: SortField | SortDirection;
    }
  ): void;
  (event: "save-settings"): void;
  (event: "test-platform", platformId: PlatformKind): void;
}>();

const sortFieldOptions: Array<{ label: string; value: SortField }> = [
  { label: "优先级", value: "priority" },
  { label: "总额度", value: "totalQuota" },
  { label: "已使用额度", value: "usedQuota" },
  { label: "剩余额度比例", value: "remainingPercent" },
  { label: "更新时间", value: "updatedAt" },
  { label: "名称", value: "name" }
];

const sortDirectionOptions: Array<{ label: string; value: SortDirection }> = [
  { label: "升序", value: "asc" },
  { label: "降序", value: "desc" }
];

function updateField(
  platformId: PlatformKind,
  key: EditableKey,
  value: string | boolean
): void {
  emit("update-platform-field", { platformId, key, value });
}

function updateSortField(platformId: PlatformKind, value: string): void {
  emit("update-sort-setting", {
    platformId,
    key: "field",
    value: value as SortField
  });
}

function updateSortDirection(platformId: PlatformKind, value: string): void {
  emit("update-sort-setting", {
    platformId,
    key: "direction",
    value: value as SortDirection
  });
}

function saveAndClose(): void {
  emit("save-settings");
  emit("update:show", false);
}
</script>

<template>
  <NModal
    :show="show"
    :mask-closable="false"
    transform-origin="center"
    @update:show="(value) => emit('update:show', value)"
  >
    <NCard
      title="配置中心"
      size="small"
      class="floating-config-modal"
      role="dialog"
      aria-modal="true"
    >
      <NGrid :cols="'1 s:1 m:2 l:2'" responsive="screen" :x-gap="16" :y-gap="16">
        <NGridItem v-for="platform in props.platforms" :key="platform.id">
          <NCard :title="platform.name.toUpperCase()" size="small" class="floating-config-modal__platform-card">
            <NForm label-placement="top">
              <NFormItem label="平台地址">
                <NInput
                  :value="platform.baseUrl"
                  placeholder="https://example.com"
                  @update:value="(value) => updateField(platform.id, 'baseUrl', value)"
                />
              </NFormItem>

              <NFormItem label="API Key">
                <NInput
                  :value="platform.apiKey"
                  type="password"
                  show-password-on="click"
                  placeholder="请输入 API Key"
                  @update:value="(value) => updateField(platform.id, 'apiKey', value)"
                />
              </NFormItem>

              <NFormItem label="卡片排序字段">
                <NSelect
                  :value="props.sortSettings[platform.id].field"
                  :options="sortFieldOptions"
                  @update:value="(value) => updateSortField(platform.id, String(value))"
                />
              </NFormItem>

              <NFormItem label="排序方向">
                <NSelect
                  :value="props.sortSettings[platform.id].direction"
                  :options="sortDirectionOptions"
                  @update:value="(value) => updateSortDirection(platform.id, String(value))"
                />
              </NFormItem>

              <NSpace justify="space-between" align="center" class="floating-config-modal__bottom">
                <NSwitch
                  :value="platform.enabled"
                  @update:value="(value) => updateField(platform.id, 'enabled', value)"
                >
                  <template #checked>启用</template>
                  <template #unchecked>停用</template>
                </NSwitch>
                <NButton
                  secondary
                  :loading="props.testLoading[platform.id]"
                  @click="emit('test-platform', platform.id)"
                >
                  测试连接
                </NButton>
              </NSpace>
            </NForm>

            <p v-if="props.checkMessages[platform.id]" class="floating-config-modal__message">
              {{ props.checkMessages[platform.id] }}
            </p>
          </NCard>
        </NGridItem>
      </NGrid>

      <NSpace justify="end" class="floating-config-modal__actions">
        <NButton @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" @click="saveAndClose">保存并关闭</NButton>
      </NSpace>
    </NCard>
  </NModal>
</template>
