<script setup lang="ts">
/**
 * 关于：版本、AI 使用说明、问题反馈入口。反馈弹层是全站共用的小方信箱（15 号文档），
 * ?feedback=1 进来时直接打开它（旧入口保留）。
 */
import SiteRecord from '@/components/SiteRecord.vue'
import { onLoad } from '@dcloudio/uni-app'
import AppShell from '@/components/AppShell.vue'
import MeSubHeader from '@/components/me/MeSubHeader.vue'
import { versionLabel } from '@/components/me/meLogic'
import { applyApiOverride } from '@/components/path/openPractice'
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgMascot from '@/components/ui/PgMascot.vue'
import { ABOUT_COPY } from '@/copy'
import { openFeedbackSheet } from '@/feedbackbox/store'
import manifest from '@/manifest.json'

const version = versionLabel((manifest as { versionName?: unknown }).versionName)

onLoad((q) => {
  applyApiOverride(q)
  if (q?.feedback === '1') openFeedbackSheet()
})
</script>

<template>
  <AppShell active="me">
    <view class="pg-about" data-testid="about-page">
      <MeSubHeader :title="ABOUT_COPY.title" />

      <PgCard class="pg-about__hero">
        <PgMascot expr="happy" :motion="['breathe', 'blink']" :size="72" />
        <text class="pg-about__name">{{ ABOUT_COPY.name }}</text>
        <text class="pg-about__tagline">{{ ABOUT_COPY.tagline }}</text>
        <text class="pg-about__version" data-testid="about-version">{{ ABOUT_COPY.version }} {{ version }}</text>
      </PgCard>

      <PgCard class="pg-about__card" data-testid="about-ai">
        <text class="pg-about__title">{{ ABOUT_COPY.aiTitle }}</text>
        <view v-for="item in ABOUT_COPY.aiItems" :key="item" class="pg-about__item">
          <view class="pg-about__dot" aria-hidden="true" />
          <text class="pg-about__itemtext">{{ item }}</text>
        </view>
      </PgCard>

      <PgCard class="pg-about__card">
        <text class="pg-about__title">{{ ABOUT_COPY.feedbackTitle }}</text>
        <text class="pg-about__itemtext">{{ ABOUT_COPY.feedbackBody }}</text>
        <PgButton variant="secondary" block sound="tap" data-testid="about-feedback" @tap="openFeedbackSheet()">{{ ABOUT_COPY.feedbackAction }}</PgButton>
      </PgCard>
      <SiteRecord />
    </view>

  </AppShell>
</template>

<style scoped>
.pg-about { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.pg-about__hero { display: flex; flex-direction: column; align-items: center; gap: var(--sp-1); text-align: center; }
.pg-about__name { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); line-height: var(--lh-tight); }
.pg-about__tagline { color: var(--ink-2); font-size: var(--fs-15); line-height: 1.5; }
.pg-about__version { margin-top: var(--sp-1); color: var(--ink-2); font-size: var(--fs-12); font-weight: var(--fw-heavy); font-variant-numeric: tabular-nums; }
.pg-about__card { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-about__title { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-about__item { display: flex; gap: var(--sp-2); }
.pg-about__dot { flex: none; width: 6px; height: 6px; margin-top: 9px; border-radius: 50%; background: var(--accent); }
.pg-about__itemtext { min-width: 0; color: var(--ink); font-size: var(--fs-15); line-height: var(--lh-body); }
</style>
