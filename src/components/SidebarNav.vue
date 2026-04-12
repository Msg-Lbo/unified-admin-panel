<script setup lang="ts">
import {
  NLayoutSider,
  NMenu,
  type MenuOption
} from "naive-ui";

defineProps<{
  value: string;
  expandedKeys: string[];
  options: MenuOption[];
}>();

const emit = defineEmits<{
  (event: "update:value", value: string): void;
  (event: "update:expanded-keys", value: string[]): void;
}>();
</script>

<template>
  <NLayoutSider bordered :width="232" class="sidebar">
    <div class="sidebar-brand">统一管理平台</div>
    <NMenu
      :value="value"
      :expanded-keys="expandedKeys"
      :options="options"
      @update:value="(menuKey) => emit('update:value', menuKey)"
      @update:expanded-keys="(keys) => emit('update:expanded-keys', keys as string[])"
    />
  </NLayoutSider>
</template>
