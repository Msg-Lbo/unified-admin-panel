<script setup lang="ts">
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NInput,
  NSpace,
  NSwitch
} from "naive-ui";
import type { PlatformConfig, PlatformKind } from "../types/platform";

type EditableKey = "baseUrl" | "apiKey" | "enabled";

const props = defineProps<{
  platforms: PlatformConfig[];
  testLoading: Record<PlatformKind, boolean>;
  checkMessages: Record<PlatformKind, string>;
}>();

const emit = defineEmits<{
  (
    event: "update-platform-field",
    payload: { platformId: PlatformKind; key: EditableKey; value: string | boolean }
  ): void;
  (event: "save-settings"): void;
  (event: "test-platform", platformId: PlatformKind): void;
}>();

function updateField(
  platformId: PlatformKind,
  key: EditableKey,
  value: string | boolean
): void {
  emit("update-platform-field", {
    platformId,
    key,
    value
  });
}
</script>

<template>
  <NGrid :cols="'1 s:1 m:2 l:2'" responsive="screen" :x-gap="16" :y-gap="16">
    <NGridItem v-for="platform in props.platforms" :key="platform.id">
      <NCard :title="platform.name" size="small" class="config-card">
        <NForm label-placement="top">
          <NFormItem label="平台地址">
            <NInput
              :value="platform.baseUrl"
              placeholder="示例：https://example.com 或 http://127.0.0.1:8080"
              @update:value="(value) => updateField(platform.id, 'baseUrl', value)"
            />
          </NFormItem>
          <NFormItem label="API Key（保存在前端 localStorage）">
            <NInput
              :value="platform.apiKey"
              type="password"
              show-password-on="click"
              placeholder="请输入平台 API Key"
              @update:value="(value) => updateField(platform.id, 'apiKey', value)"
            />
          </NFormItem>
          <NSpace justify="space-between" align="center">
            <NSwitch
              :value="platform.enabled"
              @update:value="(value) => updateField(platform.id, 'enabled', value)"
            >
              <template #checked>启用</template>
              <template #unchecked>停用</template>
            </NSwitch>
            <NSpace>
              <NButton
                secondary
                :loading="props.testLoading[platform.id]"
                @click="emit('test-platform', platform.id)"
              >
                测试连接
              </NButton>
              <NButton tertiary @click="emit('save-settings')">保存配置</NButton>
            </NSpace>
          </NSpace>
        </NForm>
        <p v-if="props.checkMessages[platform.id]" class="test-message">
          {{ props.checkMessages[platform.id] }}
        </p>
      </NCard>
    </NGridItem>
  </NGrid>
</template>
