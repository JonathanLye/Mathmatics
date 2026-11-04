<script setup lang="ts">
/** 首页（02 §4.2）：进行中 / 待完成 / 已完成。真实模式 GET /student/home；B 的 #74 未完成时回落 mock 并提示。 */
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { errorMessage, fetchHome, isMockMode, mockHome, type HomeData, type HomeItem } from '@/api/client'
import { maskStudentNo, useSession } from '@/stores/session'

const session = useSession()
const mockMode = isMockMode()
const home = ref<HomeData | null>(null)
const loading = ref(true)
const notice = ref('')

onShow(async () => {
  loading.value = true
  notice.value = ''
  try {
    home.value = await fetchHome()
  } catch (e) {
    home.value = mockHome
    if (!mockMode) notice.value = '首页接口暂不可用（B #74 待完成）：' + errorMessage(e)
  } finally {
    loading.value = false
  }
})

const hello = computed(() => home.value?.greeting ?? maskStudentNo(session.studentNo.value))

function goPractice(item: HomeItem) {
  const query = item.assignmentId
    ? '?assignmentId=' + encodeURIComponent(item.assignmentId)
    : item.mock
      ? '?mock=' + item.mock
      : ''
  uni.navigateTo({ url: '/pages/practice/index' + query })
}
function goProofbook() { uni.navigateTo({ url: '/pages/proofbook/index' }) }
</script>

<template>
  <view class="pg-page pg-home">
    <view class="pg-home__head">
      <text class="pg-home__hello">{{ hello }}</text>
      <text class="pg-home__stat pg-small">本周你自己写出了 {{ home?.weeklyOwn ?? 0 }} 个关键步骤（共 {{ home?.weeklyTotal ?? 0 }} 个）</text>
      <button class="pg-home__book pg-small" @tap="goProofbook">证明本</button>
    </view>

    <text v-if="notice" class="pg-home__notice pg-small">{{ notice }}</text>

    <view v-if="loading" class="pg-home__skeleton pg-sheet">
      <view class="pg-home__line" /><view class="pg-home__line" /><view class="pg-home__line" />
    </view>
    <template v-else-if="home">
      <text class="pg-home__section">进行中</text>
      <view v-for="a in home.ongoing" :key="a.id" class="pg-home__card pg-sheet" @tap="goPractice(a)">
        <view class="pg-home__cardmain">
          <text class="pg-home__cardtitle">{{ a.title }}</text>
          <text class="pg-home__cardsub pg-small">{{ a.layerTitle }}</text>
        </view>
        <text class="pg-home__continue">继续 ›</text>
      </view>

      <text class="pg-home__section">待完成</text>
      <view v-for="a in home.pending" :key="a.id" class="pg-home__card pg-sheet">
        <view class="pg-home__cardmain">
          <text class="pg-home__cardtitle">{{ a.title }}</text>
          <text class="pg-home__cardsub pg-small">{{ a.layerTitle }}</text>
        </view>
        <text class="pg-home__continue" @tap="goPractice(a)">开始 ›</text>
      </view>

      <text class="pg-home__section">已完成</text>
      <view v-for="a in home.completed" :key="a.id" class="pg-home__card pg-sheet">
        <view class="pg-home__cardmain">
          <text class="pg-home__cardtitle">{{ a.title }}</text>
          <text class="pg-home__cardsub pg-small">独立度 {{ a.independence ?? '-' }}</text>
        </view>
        <text class="pg-home__continue" @tap="goProofbook">证明本 ›</text>
      </view>
    </template>

    <text class="pg-home__hint pg-small">
      {{ mockMode ? '当前 mock 模式（#9）；真实首页接口 GET /student/home 待 B #74。' : '数据来自服务端 GET /student/home 与 GET /me（B #74 未完成时回落 mock）。' }}
    </text>
  </view>
</template>

<style scoped>
.pg-home { padding-top: calc(var(--safe-top) + var(--sp-4)); padding-bottom: calc(var(--sp-6) + var(--safe-bottom)); }
.pg-home__head { display: flex; flex-direction: column; gap: var(--sp-1); margin-bottom: var(--sp-4); }
.pg-home__hello { font-family: var(--font-serif); font-size: 22px; font-weight: 600; }
.pg-home__stat { color: var(--ink-2); }
.pg-home__book { align-self: flex-start; min-height: 36px; padding: 0 var(--sp-3); border: 1px solid var(--rule); border-radius: 999px; background: transparent; color: var(--ink-2); }
.pg-home__notice { display: block; margin-bottom: var(--sp-2); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-input); background: var(--hint-soft); color: var(--ink); }
.pg-home__section { display: block; margin: var(--sp-4) 0 var(--sp-2); font-family: var(--font-serif); font-size: 16px; font-weight: 600; color: var(--ink); }
.pg-home__card { display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-3); margin-bottom: var(--sp-2); }
.pg-home__cardmain { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.pg-home__cardtitle { font-size: 15px; color: var(--ink); }
.pg-home__cardsub { color: var(--ink-2); }
.pg-home__continue { color: var(--accent); font-size: 14px; }
.pg-home__skeleton { padding: var(--sp-3); }
.pg-home__line { height: 16px; border-radius: 4px; background: var(--paper); margin: var(--sp-2) 0; }
.pg-home__hint { display: block; margin-top: var(--sp-4); color: var(--ink-2); text-align: center; }
</style>
