<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NCard, NEmpty } from "naive-ui";
import * as echarts from "echarts";

const props = defineProps<{
  labels: string[];
  sub2apiValues: number[];
  cpaValues: number[];
}>();

const chartRef = ref<HTMLDivElement | null>(null);

let chart: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;
let windowResizeHandler: (() => void) | null = null;

const hasData = computed(
  () =>
    props.sub2apiValues.some((value) => value > 0) ||
    props.cpaValues.some((value) => value > 0)
);

function renderChart(): void {
  if (!chartRef.value || !chart) {
    return;
  }

  chart.setOption(
    {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis"
      },
      legend: {
        top: 8,
        textStyle: {
          color: "#64748b"
        }
      },
      grid: {
        top: 48,
        right: 20,
        bottom: 26,
        left: 56
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: props.labels,
        axisLine: {
          lineStyle: { color: "rgba(100, 116, 139, 0.45)" }
        },
        axisLabel: {
          color: "#64748b"
        }
      },
      yAxis: {
        type: "value",
        axisLine: {
          lineStyle: { color: "rgba(100, 116, 139, 0.45)" }
        },
        splitLine: {
          lineStyle: { color: "rgba(100, 116, 139, 0.18)" }
        },
        axisLabel: {
          color: "#64748b"
        }
      },
      series: [
        {
          name: "sub2api",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: {
            width: 2.5,
            color: "#0ea5e9"
          },
          areaStyle: {
            color: "rgba(14, 165, 233, 0.14)"
          },
          data: props.sub2apiValues
        },
        {
          name: "cpa",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: {
            width: 2.5,
            color: "#f59e0b"
          },
          areaStyle: {
            color: "rgba(245, 158, 11, 0.14)"
          },
          data: props.cpaValues
        }
      ]
    },
    true
  );
}

async function initChart(): Promise<void> {
  if (!chartRef.value || !hasData.value) {
    return;
  }
  await nextTick();
  chart = echarts.init(chartRef.value);
  renderChart();

  resizeObserver = new ResizeObserver(() => {
    chart?.resize();
  });
  resizeObserver.observe(chartRef.value);

  windowResizeHandler = () => chart?.resize();
  window.addEventListener("resize", windowResizeHandler);
}

function disposeChart(): void {
  if (resizeObserver && chartRef.value) {
    resizeObserver.unobserve(chartRef.value);
    resizeObserver.disconnect();
  }
  resizeObserver = null;
  if (windowResizeHandler) {
    window.removeEventListener("resize", windowResizeHandler);
    windowResizeHandler = null;
  }
  chart?.dispose();
  chart = null;
}

watch(
  () => [props.labels, props.sub2apiValues, props.cpaValues],
  async () => {
    if (!hasData.value) {
      disposeChart();
      return;
    }
    if (!chart) {
      await initChart();
      return;
    }
    renderChart();
    chart.resize();
  },
  { deep: true }
);

onMounted(async () => {
  await initChart();
});

onBeforeUnmount(() => {
  disposeChart();
});
</script>

<template>
  <NCard title="平台用量趋势（近14天）" size="small" class="panel-card trend-card">
    <template #header-extra>单位：Token</template>
    <div v-if="hasData" ref="chartRef" class="trend-echart" />
    <NEmpty v-else description="暂无用量数据，请先完成平台配置并刷新。" />
  </NCard>
</template>
