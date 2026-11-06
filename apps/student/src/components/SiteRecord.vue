<script setup lang="ts">
/** 页脚的备案信息：非经营性互联网信息服务备案管理办法要求主页底部中央标明备案号并链接工信部系统（13 §8）。没填就不显示。 */
import { MIIT_URL, PSB_URL, SITE } from '@/copy/privacy'
</script>

<template>
  <view v-if="SITE.icp || SITE.psb" class="pg-record" data-testid="site-record">
    <a v-if="SITE.icp" class="pg-record__link" :href="MIIT_URL" target="_blank" rel="noopener noreferrer" data-testid="site-icp">{{ SITE.icp }}</a>
    <a v-if="SITE.psb" class="pg-record__link" :href="PSB_URL" target="_blank" rel="noopener noreferrer" data-testid="site-psb">{{ SITE.psb }}</a>
  </view>
</template>

<style scoped>
.pg-record { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-1) var(--sp-3); padding: var(--sp-3) 0; }
.pg-record__link { color: var(--ink-2); font-size: var(--fs-13); text-decoration: none; }
</style>
