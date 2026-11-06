<script setup lang="ts">
/** 《隐私政策》：登录前也能看（网络数据安全管理条例第 21 条：集中公开展示、易于访问）。纯静态，不发请求。 */
import PgButton from '@/components/ui/PgButton.vue'
import PgCard from '@/components/ui/PgCard.vue'
import PgIcon from '@/components/ui/PgIcon.vue'
import SiteRecord from '@/components/SiteRecord.vue'
import { POLICY_TITLE, SITE, policySections } from '@/copy/privacy'

const sections = policySections()

function back(): void {
  if (getCurrentPages().length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/login/index' })
}
</script>

<template>
  <view class="pg-page pg-policy" data-testid="privacy-policy-page">
    <view class="pg-policy__head">
      <PgButton variant="ghost" size="icon" aria-label="返回" data-testid="policy-back" @tap="back"><PgIcon name="back" :size="22" /></PgButton>
      <text class="pg-policy__title">{{ POLICY_TITLE }}</text>
    </view>
    <text class="pg-policy__date">{{ SITE.effectiveDate }} 生效</text>

    <PgCard v-for="section in sections" :key="section.id" class="pg-policy__card" :data-testid="'policy-' + section.id">
      <text class="pg-policy__name">{{ section.title }}</text>
      <text v-for="(text, i) in section.paragraphs ?? []" :key="i" class="pg-policy__text">{{ text }}</text>
      <view v-for="row in section.rows ?? []" :key="row.name" class="pg-policy__row">
        <text class="pg-policy__rowname">{{ row.name }}</text>
        <text class="pg-policy__rowdetail">{{ row.detail }}</text>
      </view>
    </PgCard>

    <SiteRecord />
  </view>
</template>

<style scoped>
.pg-policy { display: flex; flex-direction: column; gap: var(--sp-3); max-width: 640px; margin: 0 auto; padding: calc(var(--safe-top) + var(--sp-3)) var(--sp-4) calc(var(--safe-bottom) + var(--sp-8)); }
.pg-policy__head { display: flex; align-items: center; gap: var(--sp-2); }
.pg-policy__title { color: var(--ink); font-size: var(--fs-22); font-weight: var(--fw-black); }
.pg-policy__date { color: var(--ink-2); font-size: var(--fs-13); }
.pg-policy__card { display: flex; flex-direction: column; gap: var(--sp-2); }
.pg-policy__name { color: var(--ink); font-size: var(--fs-16); font-weight: var(--fw-black); }
.pg-policy__text { color: var(--ink); font-size: var(--fs-15); line-height: 1.7; }
.pg-policy__row { display: flex; flex-direction: column; gap: 2px; padding-top: var(--sp-2); border-top: var(--bw) solid var(--rule); }
.pg-policy__rowname { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-bold); }
.pg-policy__rowdetail { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.6; }
</style>
