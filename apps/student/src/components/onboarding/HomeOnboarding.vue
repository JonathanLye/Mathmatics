<script setup lang="ts">
/**
 * 首页的新手引导挂载点（首页只需要引入并放一个 <HomeOnboarding :ready="..." />）：
 * 放在 AppShell 外面（和“我的”页的退出对话框一样）：外壳的进入动画会让里面的 fixed 元素按外壳定位，聚光灯就偏了。
 * 1. 还没走欢迎页的新学生（深链、中途退出后再登录）先送去欢迎页；
 * 2. 首页内容出来后，第一次进来弹三步聚光灯导览（路径 → 今日目标 → 我的），看过或跳过都只记一次；
 * 目标按 data-testid 找（见 copy 里的 TOUR_STEPS，按顺序试几个选择器），首页改版也不会掉链子；找不到时气泡居中显示，不卡住。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import PgCoachmark from '@/components/ui/PgCoachmark.vue'
import { shouldGoWelcome, useOnboarding } from '@/composables/useOnboarding'
import { TOUR_STEPS, TOUR_UI } from '@/copy/onboarding'
import { useSession } from '@/stores/session'

const props = defineProps<{ ready: boolean }>()

const session = useSession()
const onboarding = useOnboarding()
const open = ref(false)
const index = ref(0)
const checked = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

async function check(): Promise<void> {
  if (await shouldGoWelcome()) {
    uni.redirectTo({ url: '/pages/welcome/index' })
    return
  }
  checked.value = true
}

// 等拿到 Me（刷新页面时稍晚一点）再问设置，免得按空账号缓存。
watch(
  () => session.me.value?.userId,
  (userId) => {
    if (userId && !checked.value) void check()
  },
  { immediate: true },
)

watch(
  () => [props.ready, checked.value] as const,
  ([ready, done]) => {
    if (!ready || !done || open.value || !onboarding.canShow('tour')) return
    // 等页面进入动画停稳再量位置。
    timer = setTimeout(() => {
      if (onboarding.canShow('tour')) open.value = true
    }, 600)
  },
  { immediate: true },
)

function close(): void {
  open.value = false
  void onboarding.markSeen('tour')
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <PgCoachmark
    :open="open"
    :steps="TOUR_STEPS"
    v-model:index="index"
    :next-text="TOUR_UI.next"
    :done-text="TOUR_UI.done"
    :skip-text="TOUR_UI.skip"
    @skip="close"
    @done="close"
  />
</template>
