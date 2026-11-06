<script setup lang="ts">
/**
 * 兜底页：地址不存在（App.onPageNotFound），或页面渲染崩了（main.ts 的全局错误处理跳过来，kind=error）。
 * 出错时带上原路由，“再试一次”回到那一页；只接受站内 /pages/ 路径。
 */
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import { retryRoute } from '@/components/ui/uiLogic'

const crashed = ref(false)
const from = ref<string | null>(null)

onLoad((query) => {
  crashed.value = query?.kind === 'error'
  from.value = retryRoute(query?.from ? decodeURIComponent(String(query.from)) : null)
})

const title = computed(() => (crashed.value ? '这一页出了点小问题' : '这里什么也没有'))
const body = computed(() => (crashed.value ? '你写的内容还在，重新打开试试。' : '这个地址可能写错了，回到路径继续吧。'))
const action = computed(() => (crashed.value && from.value ? '再试一次' : '回到路径'))

function go(): void {
  uni.reLaunch({ url: crashed.value && from.value ? from.value : '/pages/home/index' })
}
</script>

<template>
  <view class="pg-page pg-lost" data-testid="not-found-page">
    <PgEmpty :title="title" :body="body" expr="oops" :motion="null" :size="128" :action="action" action-testid="not-found-action" @action="go" />
  </view>
</template>

<style scoped>
.pg-lost { display: flex; align-items: center; justify-content: center; min-height: 100vh; min-height: 100dvh; }
</style>
