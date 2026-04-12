<script setup lang="ts">
import { computed, h } from "vue";
import {
  NButton,
  NCard,
  NDataTable,
  NInput,
  NSpace,
  NTag,
  type DataTableColumns,
  type DataTableRowKey
} from "naive-ui";
import type { UnifiedAccount } from "../types/platform";
import UsageProgressCell from "./UsageProgressCell.vue";
import QuotaAmountCell from "./QuotaAmountCell.vue";

const props = defineProps<{
  title: string;
  accounts: UnifiedAccount[];
  loading: boolean;
  tableMaxHeight: number;
  keyword: string;
  selectedRowKeys: DataTableRowKey[];
  selectedCount: number;
  rowLoadingMap: Record<string, boolean>;
  actionLoading: boolean;
}>();

const emit = defineEmits<{
  (event: "update:keyword", value: string): void;
  (event: "update:selectedRowKeys", value: DataTableRowKey[]): void;
  (event: "open-detail", account: UnifiedAccount): void;
  (event: "open-edit", account: UnifiedAccount): void;
  (event: "toggle-account", account: UnifiedAccount): void;
  (event: "batch-enable", enabled: boolean): void;
  (event: "open-batch-edit"): void;
  (event: "clear-selection"): void;
}>();

function classifyStatus(status: string): "healthy" | "warning" | "error" {
  const normalized = status.trim().toLowerCase();
  if (
    normalized.includes("error") ||
    normalized.includes("invalid") ||
    normalized.includes("banned") ||
    normalized.includes("failed")
  ) {
    return "error";
  }
  if (
    normalized.includes("inactive") ||
    normalized.includes("disabled") ||
    normalized.includes("quota") ||
    normalized.includes("exhausted") ||
    normalized.includes("limit") ||
    normalized.includes("retry")
  ) {
    return "warning";
  }
  return "healthy";
}

function formatStatusLabel(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (
    normalized.includes("quota_exhausted") ||
    normalized.includes("usage_limit_reached") ||
    normalized.includes("insufficient_quota")
  ) {
    return "额度用尽";
  }
  if (normalized.includes("rate_limited") || normalized.includes("rate limit")) {
    return "限流中";
  }
  if (normalized === "active") {
    return "正常";
  }
  if (normalized === "disabled" || normalized === "inactive") {
    return "停用";
  }
  if (normalized === "error") {
    return "异常";
  }
  return status;
}

function isDisabledStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized.includes("disabled") || normalized.includes("inactive");
}

function formatDate(raw?: string): string {
  if (!raw) {
    return "-";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return date.toLocaleString();
}

const columns = computed<DataTableColumns<UnifiedAccount>>(() => [
  {
    type: "selection",
    width: 42
  },
  {
    title: "名称",
    key: "name",
    minWidth: 190,
    sorter: (a, b) => a.name.localeCompare(b.name),
    ellipsis: {
      tooltip: true
    }
  },
  {
    title: "类型",
    key: "type",
    minWidth: 140,
    sorter: (a, b) => a.type.localeCompare(b.type)
  },
  {
    title: "状态",
    key: "status",
    width: 120,
    sorter: (a, b) => a.status.localeCompare(b.status),
    render: (row) =>
      h(
        NTag,
        {
          type:
            classifyStatus(row.status) === "healthy"
              ? "success"
              : classifyStatus(row.status) === "warning"
              ? "warning"
              : "error",
          bordered: false
        },
        {
          default: () => formatStatusLabel(row.status)
        }
      )
  },
  {
    title: "邮箱 / 账号",
    key: "email",
    minWidth: 220,
    sorter: (a, b) => (a.email ?? "").localeCompare(b.email ?? ""),
    render: (row) => row.email ?? "-"
  },
  {
    title: "配额进度",
    key: "usageProgress",
    width: 320,
    render: (row) => h(UsageProgressCell, { account: row })
  },
  {
    title: "额度",
    key: "quotaAmount",
    width: 210,
    render: (row) => h(QuotaAmountCell, { account: row })
  },
  {
    title: "优先级",
    key: "priority",
    width: 92,
    sorter: (a, b) => (a.priority ?? -1) - (b.priority ?? -1),
    render: (row) =>
      typeof row.priority === "number" ? String(row.priority) : "-"
  },
  {
    title: "更新时间",
    key: "updatedAt",
    width: 190,
    sorter: (a, b) =>
      new Date(a.updatedAt ?? 0).getTime() - new Date(b.updatedAt ?? 0).getTime(),
    render: (row) => formatDate(row.updatedAt)
  },
  {
    title: "操作",
    key: "action",
    width: 270,
    render: (row) => {
      const rowLoading = Boolean(props.rowLoadingMap[row.uid]);
      const enableLabel = isDisabledStatus(row.status) ? "启用" : "停用";
      return h(
        "div",
        {
          class: "row-actions"
        },
        [
          h(
            NButton,
            {
              size: "tiny",
              tertiary: true,
              disabled: rowLoading,
              onClick: () => emit("open-detail", row)
            },
            { default: () => "详情" }
          ),
          h(
            NButton,
            {
              size: "tiny",
              tertiary: true,
              disabled: rowLoading,
              onClick: () => emit("open-edit", row)
            },
            { default: () => "编辑" }
          ),
          h(
            NButton,
            {
              size: "tiny",
              type: isDisabledStatus(row.status) ? "primary" : "warning",
              disabled: rowLoading,
              loading: rowLoading,
              onClick: () => emit("toggle-account", row)
            },
            { default: () => enableLabel }
          )
        ]
      );
    }
  }
]);
</script>

<template>
  <NCard :title="title" size="small" class="table-card">
    <div class="table-tools">
      <NSpace align="center" wrap>
        <NInput
          :value="keyword"
          placeholder="按名称 / 账号 / 状态搜索"
          clearable
          style="width: min(380px, 100%)"
          @update:value="(value) => emit('update:keyword', value)"
        />
      </NSpace>
      <NSpace align="center">
        <span class="selection-count">
          已选：{{ selectedCount }}
        </span>
        <NButton
          size="small"
          :disabled="!selectedCount || actionLoading"
          :loading="actionLoading"
          @click="emit('batch-enable', true)"
        >
          批量启用
        </NButton>
        <NButton
          size="small"
          type="warning"
          :disabled="!selectedCount || actionLoading"
          :loading="actionLoading"
          @click="emit('batch-enable', false)"
        >
          批量停用
        </NButton>
        <NButton
          size="small"
          tertiary
          :disabled="!selectedCount || actionLoading"
          @click="emit('open-batch-edit')"
        >
          批量编辑
        </NButton>
        <NButton size="small" tertiary @click="emit('clear-selection')">
          清空选择
        </NButton>
      </NSpace>
    </div>

    <NDataTable
      :checked-row-keys="selectedRowKeys"
      :columns="columns"
      :data="accounts"
      :loading="loading"
      :pagination="{ pageSize: 20 }"
      :row-key="(row) => row.uid"
      :max-height="tableMaxHeight"
      :scroll-x="1760"
      @update:checked-row-keys="(keys) => emit('update:selectedRowKeys', keys)"
    />
  </NCard>
</template>
