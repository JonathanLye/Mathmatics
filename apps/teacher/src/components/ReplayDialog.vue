<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api, ApiError } from '../api/client.ts';
import type { StoredEvent } from '../api/types.ts';
import { buildFrames, buildMarkers, frameAt, type ReplayFrame } from '../utils/replay.ts';

const props = defineProps<{ visible: boolean; attemptId: string | null }>();
const emit = defineEmits<{ 'update:visible': [value: boolean] }>();

const frames = ref<ReplayFrame[]>([]);
const loading = ref(false);
const error = ref('');
const seq = ref(0);
const playing = ref(false);
const speed = ref(4);
let timer: number | undefined;

const markers = computed(() => (frames.value.length > 0 ? buildMarkers(frames.value) : []));
const current = computed(() => frameAt(frames.value, seq.value));
const lastSeq = computed(() => frames.value.at(-1)?.seq ?? 0);
const maxSeq = computed(() => Math.max(lastSeq.value, 1));

const speedOptions = [
  { label: '1×', value: 1 },
  { label: '4×', value: 4 },
  { label: '16×', value: 16 },
];

function messageOf(caught: unknown): string {
  return caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : '加载事件失败';
}

async function load(): Promise<void> {
  const attemptId = props.attemptId;
  if (attemptId === null) return;
  loading.value = true;
  error.value = '';
  try {
    const all: StoredEvent[] = [];
    let after = 0;
    for (;;) {
      const page = await api.get<{ events: StoredEvent[]; nextSeq: number | null }>(
        `/api/v1/teacher/attempts/${attemptId}/events?afterSeq=${after}&limit=1000`,
      );
      all.push(...page.events);
      if (page.nextSeq === null || all.length >= 5000) break;
      after = page.nextSeq;
    }
    frames.value = buildFrames(all);
    seq.value = lastSeq.value;
  } catch (caught) {
    frames.value = [];
    error.value = messageOf(caught);
  } finally {
    loading.value = false;
  }
}

function stop(): void {
  playing.value = false;
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

function play(): void {
  if (playing.value || frames.value.length === 0) return;
  if (seq.value >= lastSeq.value) seq.value = 0;
  playing.value = true;
  timer = window.setInterval(() => {
    seq.value = Math.min(lastSeq.value, seq.value + speed.value);
    if (seq.value >= lastSeq.value) stop();
  }, 180);
}

function close(): void {
  stop();
  emit('update:visible', false);
}

watch(
  () => [props.visible, props.attemptId],
  () => {
    if (props.visible) void load();
    else stop();
  },
  { immediate: true },
);

onBeforeUnmount(stop);

const TONE_LABEL: Record<string, string> = {
  layer: '层切换',
  line: '提交',
  hint: '提示',
  note: '批注',
  away: '离开',
  other: '其他',
};
</script>

<template>
  <t-dialog :visible="visible" header="回放（事件级）" width="860px" :footer="false" @close="close">
    <div v-if="error" style="padding: 8px 0">
      <t-alert theme="error" :message="error" />
    </div>
    <t-loading v-else-if="loading" />
    <div v-else>
      <div class="replay-cards">
        <div class="replay-card"><b>{{ current?.layer ?? '—' }}</b><span>层</span></div>
        <div class="replay-card"><b>{{ current?.lines ?? 0 }}</b><span>已提交行</span></div>
        <div class="replay-card"><b>{{ current?.keys ?? 0 }}</b><span>关键步骤</span></div>
        <div class="replay-card"><b>{{ current?.hints ?? 0 }}</b><span>提示</span></div>
        <div class="replay-card"><b>{{ current?.notes ?? 0 }}</b><span>批注</span></div>
        <div class="replay-card"><b>{{ Math.round((current?.awayMs ?? 0) / 1000) }}s</b><span>离开时长</span></div>
      </div>

      <div class="replay-controls">
        <t-button size="small" theme="primary" @click="playing ? stop() : play()">{{ playing ? '暂停' : '播放' }}</t-button>
        <t-select v-model="speed" :options="speedOptions" size="small" style="width: 92px" />
        <span class="page-sub">事件 {{ seq }} / {{ lastSeq }}</span>
        <span v-if="current?.away" class="replay-away">离开中</span>
        <span v-if="current" class="page-sub">{{ new Date(current.at).toLocaleTimeString('zh-CN') }} · {{ current.label }}</span>
      </div>

      <t-slider v-model="seq" :min="0" :max="maxSeq" :step="1" :disabled="loading" />

      <div class="replay-markers">
        <t-tag
          v-for="marker in markers"
          :key="marker.seq"
          size="small"
          variant="light"
          :theme="marker.tone === 'away' ? 'warning' : marker.tone === 'hint' ? 'primary' : 'default'"
          style="cursor: pointer"
          @click="seq = marker.seq"
        >
          #{{ marker.seq }} {{ TONE_LABEL[marker.tone] ?? marker.tone }} · {{ marker.label }}
        </t-tag>
      </div>

      <div class="page-sub" style="margin-top: 10px">
        事件级回放：层/提交/提示/批注/离开可还原；引擎 AttemptState 级重放需要 `/teacher/problems` 或服务端回放接口（契约缺口，待 B 补）。
      </div>
    </div>
  </t-dialog>
</template>

<style scoped>
.replay-cards {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.replay-card {
  border: 1px solid var(--td-component-border, #e3e6eb);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.replay-card b {
  font-size: 20px;
}
.replay-card span {
  font-size: 12px;
  color: var(--td-text-color-secondary, #5e6670);
}
.replay-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.replay-away {
  color: var(--td-warning-color, #ff7d00);
}
.replay-markers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 160px;
  overflow: auto;
  margin-top: 8px;
}
</style>
