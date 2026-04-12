<script setup lang="ts">
import { NButton, NSelect, NSpace, type SelectOption } from "naive-ui";

defineProps<{
  isDark: boolean;
  loading: boolean;
  autoRefreshSeconds: number;
  autoRefreshOptions: SelectOption[];
}>();

const emit = defineEmits<{
  (event: "toggle-theme"): void;
  (event: "refresh"): void;
  (event: "update:autoRefreshSeconds", value: number): void;
}>();
</script>

<template>
  <div class="top-bar">
    <div class="top-bar__left">
      <h1>Unified Account Console</h1>
      <p>CLIProxyAPI + sub2api account management</p>
    </div>
    <NSpace>
      <NSelect
        :value="autoRefreshSeconds"
        :options="autoRefreshOptions"
        style="width: 150px"
        @update:value="(value) => emit('update:autoRefreshSeconds', value)"
      />
      <NButton tertiary @click="emit('toggle-theme')">
        {{ isDark ? "Switch to Light" : "Switch to Dark" }}
      </NButton>
      <NButton type="primary" :loading="loading" @click="emit('refresh')">
        Refresh Accounts
      </NButton>
    </NSpace>
  </div>
</template>
