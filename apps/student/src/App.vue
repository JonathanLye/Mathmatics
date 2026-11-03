<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

// 全局启动钩子：H5 端记录一次启动，方便后续接入事件 SDK（Day2 #27）。
onLaunch(() => {
  // eslint-disable-next-line no-console
  console.log('[proof-gym] app launch')
})
</script>

<style>
/* 全局样式在 main.ts 里以 CSS 文件引入，这里不写 scoped 样式。 */
</style>
