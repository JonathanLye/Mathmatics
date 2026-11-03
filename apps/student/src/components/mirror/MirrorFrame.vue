<script setup lang="ts">
/**
 * 教师镜像预览容器（issue #43 A 侧子集；04 §5.1）。
 *
 * 只读 iframe 打开学生 H5 的 /s/mirror?attempt=…&token=…：
 * - 真正的只读（禁用输入/按钮、顶部标「只读」）在学生端镜像页面内实现，本组件只负责安全装载 + 状态；
 * - sandbox 最小权限：allow-scripts + allow-same-origin（镜像页是学生 H5 同源应用，需要脚本与同源存储/SSE），
 *   不开放表单、弹窗、顶层跳转；允许全屏（04 §5.1 教师可能需放大看）；
 * - referrerpolicy="no-referrer"：避免 token 通过 Referer 头泄露到第三方资源；
 * - token 只存在于 iframe 的 src 查询参数（功能必需），不在可见文本 / 错误文案 / 日志里出现；
 * - 拒绝非 http(s)、缺 attempt/token、以及 https 页面加载 http 的混合内容。
 *
 * emits 是本组件的扩展（契约文档见 ./README.md）：load 表示 iframe 触发 load，error 表示装载失败。
 * 组件本轮不接线（build 不打包），后续由教师端 #51/C 接入。
 */
import { computed, ref, watch } from 'vue'
import { isMirrorPageUrl, isMixedContent } from './mirror'

const props = withDefaults(
  defineProps<{
    /** 完整镜像页 URL（含 attempt/token 查询参数），由 buildMirrorUrl 生成 */
    src?: string
    /** iframe 的 title（a11y 必需） */
    title?: string
    /** 父级驱动：请求中（重新取 token / 等待 SSE） */
    loading?: boolean
    /** 父级传入的人话错误（优先于内部状态） */
    error?: string | null
  }>(),
  { src: '', title: '学生作答镜像', loading: false, error: null },
)
const emit = defineEmits<{
  (e: 'load'): void
  (e: 'error', message: string): void
}>()

type FrameStatus = 'empty' | 'loading' | 'ready' | 'error'

const status = ref<FrameStatus>('empty')
const internalError = ref('')

const safeSrc = computed(() => {
  const raw = (props.src ?? '').trim()
  if (!raw) return ''
  return isMirrorPageUrl(raw) ? raw : ''
})

const isLoading = computed(() => props.loading || status.value === 'loading')
const errorMessage = computed(() => props.error || internalError.value)
const showFrame = computed(() => status.value === 'loading' || status.value === 'ready')

/** iframe 安全属性集中声明（不写进模板，避免误加 allow-forms / allow-popups 等）。 */
const iframeAttrs: Record<string, string> = {
  sandbox: 'allow-scripts allow-same-origin',
  referrerpolicy: 'no-referrer',
  allow: 'fullscreen',
  allowfullscreen: '',
}

function evaluate() {
  const raw = (props.src ?? '').trim()
  internalError.value = ''
  if (props.error) {
    status.value = 'error'
    return
  }
  if (!raw) {
    status.value = 'empty'
    return
  }
  if (!isMirrorPageUrl(raw)) {
    status.value = 'error'
    internalError.value = '镜像地址不完整或协议不受支持，已停止加载；请重新获取镜像令牌。'
    return
  }
  if (isMixedContent(raw)) {
    status.value = 'error'
    internalError.value = '镜像地址是 http，而教师端是 https，浏览器会拦截混合内容；请让服务端提供 https 的镜像地址，或与学生端同源部署。'
    return
  }
  status.value = 'loading'
}

watch(
  [() => props.src, () => props.error],
  () => evaluate(),
  { immediate: true },
)

function onFrameLoad() {
  if (!showFrame.value) return
  status.value = 'ready'
  internalError.value = ''
  emit('load')
}

function onFrameError() {
  status.value = 'error'
  internalError.value = '镜像页面加载失败，请重新获取镜像令牌后重试。'
  emit('error', internalError.value)
}
</script>

<template>
  <view class="pg-mirror" data-testid="mirror-frame">
    <view class="pg-mirror__head">
      <text class="pg-mirror__title">{{ props.title }}</text>
      <text class="pg-mirror__tag pg-small">只读 · 老师预览中</text>
    </view>

    <view v-if="status === 'empty'" class="pg-mirror__placeholder" data-testid="mirror-empty">
      <text class="pg-mirror__placeholder-title">还没有打开镜像预览</text>
      <text class="pg-mirror__placeholder-hint pg-small">在左侧学生详情里点「镜像预览」，这里会显示学生此刻的页面（只读）。</text>
    </view>

    <view v-else-if="status === 'error'" class="pg-mirror__error" role="alert" data-testid="mirror-error">
      <text class="pg-mirror__error-title">镜像不可用</text>
      <text class="pg-mirror__error-msg pg-small">{{ errorMessage }}</text>
      <text class="pg-mirror__error-hint pg-small">镜像加载失败不会影响学生作答。</text>
    </view>

    <view v-else class="pg-mirror__stage" :aria-busy="isLoading ? 'true' : 'false'">
      <iframe
        :src="safeSrc"
        :title="props.title"
        v-bind="iframeAttrs"
        class="pg-mirror__iframe"
        data-testid="mirror-iframe"
        @load="onFrameLoad"
        @error="onFrameError"
      />
      <view v-if="isLoading" class="pg-mirror__loading" data-testid="mirror-loading">
        <text class="pg-mirror__loading-text pg-small">正在连接学生当前页面…</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.pg-mirror {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}

.pg-mirror__head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

.pg-mirror__title {
  font-family: var(--font-serif);
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
}

.pg-mirror__tag {
  padding: 1px var(--sp-2);
  border: 1px solid var(--accent);
  border-radius: 999px;
  color: var(--accent);
  background: var(--accent-soft);
  white-space: nowrap;
}

/* 无 src 占位 / 错误态：与 iframe 同高的纸面，避免加载前后跳动。 */
.pg-mirror__placeholder,
.pg-mirror__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  width: 100%;
  aspect-ratio: 16 / 9;
  padding: var(--sp-4);
  border: 1px dashed var(--rule);
  border-radius: var(--radius-card);
  background: var(--paper);
  color: var(--ink-2);
  text-align: center;
}

.pg-mirror__placeholder-title,
.pg-mirror__error-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink-2);
}

.pg-mirror__placeholder-hint,
.pg-mirror__error-msg,
.pg-mirror__error-hint {
  max-width: 46ch;
  line-height: var(--lh-body);
  color: var(--ink-2);
}

.pg-mirror__stage {
  position: relative;
  width: 100%;
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  overflow: hidden;
  background: var(--sheet);
}

/* 16:9 自适应（容器更宽时按宽度算高；桌面教师端可用父级覆盖高度）。 */
.pg-mirror__iframe {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  background: var(--sheet);
}

.pg-mirror__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sheet);
  color: var(--ink-2);
}

.pg-mirror__loading-text {
  color: var(--ink-2);
}
</style>
