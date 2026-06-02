<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NScrollbar, NSpace } from "naive-ui";
import {
  buildJsonFoldLines,
  collectFoldablePaths,
  type JsonFoldLine
} from "../utils/jsonHighlight";

const props = defineProps<{
  value: unknown;
  height?: string;
}>();

const JSON_VIEWER_HEIGHT = "min(62vh, 520px)";

const collapsedPaths = ref(new Set<string>());

const scrollStyle = computed(() => ({
  maxHeight: props.height ?? JSON_VIEWER_HEIGHT,
  height: props.height ?? JSON_VIEWER_HEIGHT
}));

const viewerStyle = computed(() => ({
  height: props.height ?? JSON_VIEWER_HEIGHT,
  maxHeight: props.height ?? JSON_VIEWER_HEIGHT
}));

const foldLines = computed(() => buildJsonFoldLines(props.value, collapsedPaths.value));

const numberedLines = computed(() =>
  foldLines.value.map((line, index) => ({
    ...line,
    lineNumber: index + 1
  }))
);

watch(
  () => props.value,
  () => {
    collapsedPaths.value = new Set();
  }
);

function toggleFold(path: string): void {
  const next = new Set(collapsedPaths.value);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  collapsedPaths.value = next;
}

function expandAll(): void {
  collapsedPaths.value = new Set();
}

function collapseAll(): void {
  const next = new Set<string>();
  collectFoldablePaths(props.value, next);
  collapsedPaths.value = next;
}

function handleFoldClick(line: JsonFoldLine & { lineNumber: number }, event: Event): void {
  event.stopPropagation();
  if (!line.foldable) {
    return;
  }
  toggleFold(line.path);
}
</script>

<template>
  <div class="json-fold-viewer">
    <div class="json-fold-viewer__toolbar">
      <NSpace size="small">
        <NButton size="tiny" tertiary @click="expandAll">全部展开</NButton>
        <NButton size="tiny" tertiary @click="collapseAll">全部折叠</NButton>
      </NSpace>
    </div>
    <div class="json-fold-viewer__panel" :style="viewerStyle">
      <NScrollbar :style="scrollStyle" :x-scrollable="true" trigger="none">
        <div class="json-fold-viewer__lines">
          <div
            v-for="line in numberedLines"
            :key="`${line.path}-${line.lineNumber}`"
            class="json-fold-viewer__line"
          >
            <span class="json-fold-viewer__ln">{{ line.lineNumber }}</span>
            <button
              v-if="line.foldable"
              type="button"
              class="json-fold-viewer__toggle"
              :aria-label="collapsedPaths.has(line.path) ? '展开' : '折叠'"
              @click="handleFoldClick(line, $event)"
            >
              {{ collapsedPaths.has(line.path) ? "▸" : "▾" }}
            </button>
            <span v-else class="json-fold-viewer__toggle json-fold-viewer__toggle--placeholder" />
            <code
              class="json-fold-viewer__code"
              :style="{ paddingLeft: `${line.depth * 16}px` }"
              v-html="line.html"
            />
          </div>
        </div>
      </NScrollbar>
    </div>
  </div>
</template>

<style scoped>
.json-fold-viewer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.json-fold-viewer__toolbar {
  display: flex;
  justify-content: flex-end;
}

.json-fold-viewer__panel {
  border-radius: 10px;
  border: 1px solid rgba(71, 85, 105, 0.55);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.96) 0%, rgba(10, 16, 30, 0.98) 100%);
  overflow: hidden;
}

.json-fold-viewer__lines {
  min-width: max-content;
  padding: 8px 0;
}

.json-fold-viewer__line {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  min-height: 20px;
  padding: 0 12px 0 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
    "Courier New", monospace;
  font-size: 12px;
  line-height: 20px;
}

.json-fold-viewer__ln {
  flex: 0 0 36px;
  text-align: right;
  color: rgba(100, 116, 139, 0.95);
  user-select: none;
}

.json-fold-viewer__toggle {
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  padding: 0;
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 10px;
  line-height: 16px;
  cursor: pointer;
}

.json-fold-viewer__toggle:hover {
  color: #e2e8f0;
}

.json-fold-viewer__toggle--placeholder {
  cursor: default;
  visibility: hidden;
}

.json-fold-viewer__code {
  flex: 1;
  min-width: 0;
  white-space: pre;
  color: #cbd5e1;
}

.json-fold-viewer__code :deep(.json-hl__key) {
  color: #7dd3fc;
}

.json-fold-viewer__code :deep(.json-hl__string) {
  color: #86efac;
}

.json-fold-viewer__code :deep(.json-hl__number) {
  color: #fcd34d;
}

.json-fold-viewer__code :deep(.json-hl__boolean) {
  color: #c4b5fd;
}

.json-fold-viewer__code :deep(.json-hl__null) {
  color: #94a3b8;
  font-style: italic;
}
</style>
