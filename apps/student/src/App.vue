<script setup lang="ts">
import { onHide, onLaunch } from '@dcloudio/uni-app'
import { initIntegrity } from '@/integrity/sdk'

// 全局启动钩子（#27）：初始化诚信事件 SDK（visibility/blur/copy/paste/multitab/network + 批量上报）。
// 只在客户端执行；页面隐藏/卸载由 SDK 自己 flushBeacon，不阻塞启动。
onLaunch(() => {
  initIntegrity()
})

// 切后台时立即把队列里的诚信事件发出去（11 §3：页面隐藏用 beacon）。
// 注意：不在 onHide 里 destroy——否则回到前台后采集器不会恢复；SDK 实例随应用生命周期存在。
onHide(() => {
  void initIntegrity().flushBeacon()
})
</script>

<style>
/* 全局样式在 main.ts 里以 CSS 文件引入，这里不写 scoped 样式。 */
</style>
