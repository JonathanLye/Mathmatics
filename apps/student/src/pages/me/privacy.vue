<script setup lang="ts">
/**
 * 隐私与同意书：看自己签过的版本；必选项只读，可选项随时改（POST /consents，五个键一起提交）。
 * 改动先显示，失败退回原来的值并提示，不假装成功。监护人告知只读，不参与签署。
 */
import { POLICY_TITLE } from '@/copy/privacy'
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { errorMessage, getConsents, submitConsents } from '@/api/client'
import AppShell from '@/components/AppShell.vue'
import TagChip from '@/components/TagChip.vue'
import MeSubHeader from '@/components/me/MeSubHeader.vue'
import { consentChoices, consentSectionKind, isSignableKey } from '@/components/me/meLogic'
import { applyApiOverride } from '@/components/path/openPractice'
import PgCard from '@/components/ui/PgCard.vue'
import PgEmpty from '@/components/ui/PgEmpty.vue'
import PgFold from '@/components/ui/PgFold.vue'
import PgSkeleton from '@/components/ui/PgSkeleton.vue'
import PgSwitch from '@/components/ui/PgSwitch.vue'
import { useToast } from '@/components/ui/useToast'
import { PRIVACY_COPY, consentVersionLabel } from '@/copy'
import { useSession } from '@/stores/session'
import type { ConsentChoices, ConsentDoc, ConsentKey, ConsentSection } from '@/types/attempt'
import { formatDate } from '@/utils/date'

const session = useSession()
const toast = useToast()
const doc = ref<ConsentDoc | null>(null)
const choices = ref<ConsentChoices | null>(null)
const loading = ref(true)
const error = ref('')
const saving = ref(false)

onLoad((q) => {
  applyApiOverride(q)
  void load()
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const next = await getConsents()
    doc.value = next
    choices.value = consentChoices(next)
  } catch (e) {
    doc.value = null
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

const versionLine = computed(() => {
  const value = doc.value
  if (!value) return ''
  return value.signed
    ? PRIVACY_COPY.signed(consentVersionLabel(value.signed.version), formatDate(value.signed.signedAt))
    : PRIVACY_COPY.unsigned(consentVersionLabel(value.version))
})

function isOn(section: ConsentSection): boolean {
  return isSignableKey(section.key) && Boolean(choices.value?.[section.key])
}

async function toggle(key: ConsentKey, value: boolean): Promise<void> {
  if (!doc.value || !choices.value || saving.value) return
  const before = choices.value
  const after = { ...before, [key]: value }
  choices.value = after
  saving.value = true
  try {
    await submitConsents(doc.value.version, after)
    toast.show(PRIVACY_COPY.saved, { tone: 'ok' })
    void session.refreshMe()
  } catch {
    choices.value = before
    toast.show(PRIVACY_COPY.saveFailed, { tone: 'warn' })
  } finally {
    saving.value = false
  }
}

function goPolicy(): void {
  uni.navigateTo({ url: '/pages/privacy-policy/index' })
}
</script>

<template>
  <AppShell active="me">
    <view class="pg-privacy" data-testid="privacy-page">
      <MeSubHeader :title="PRIVACY_COPY.title" />
      <text class="pg-privacy__policy" role="link" tabindex="0" data-testid="privacy-policy-link" @tap="goPolicy">看完整的《{{ POLICY_TITLE }}》：处理哪些信息、存多久、怎么查询和删除</text>

      <PgCard v-if="loading" data-testid="privacy-loading" aria-busy="true"><PgSkeleton :count="4" /></PgCard>

      <view v-else-if="error" data-testid="privacy-error" role="alert">
        <PgEmpty :title="PRIVACY_COPY.loadFailedTitle" :body="error" expr="oops" :motion="null" :size="88" action="重试" action-testid="privacy-retry" @action="load" />
      </view>

      <template v-else-if="doc">
        <view class="pg-privacy__intro">
          <text class="pg-privacy__version" data-testid="privacy-version">{{ versionLine }}</text>
          <text class="pg-privacy__explain">{{ PRIVACY_COPY.explain }}</text>
        </view>

        <PgCard v-for="section in doc.sections" :key="section.key" class="pg-privacy__item" data-testid="privacy-item" :data-key="section.key" :data-kind="consentSectionKind(section)">
          <view class="pg-privacy__head">
            <text class="pg-privacy__name">{{ section.title }}</text>
            <TagChip v-if="consentSectionKind(section) === 'readonly'" data-testid="privacy-readonly">{{ PRIVACY_COPY.readonly }}</TagChip>
            <TagChip v-else-if="consentSectionKind(section) === 'required'" tone="accent" data-testid="privacy-required">{{ PRIVACY_COPY.required }}</TagChip>
            <PgSwitch
              v-else-if="isSignableKey(section.key)"
              :model-value="isOn(section)"
              :label="section.title"
              :disabled="saving"
              :data-testid="'privacy-switch-' + section.key"
              @update:model-value="toggle(section.key as ConsentKey, $event)"
            />
          </view>
          <text v-if="consentSectionKind(section) === 'optional' && PRIVACY_COPY.optionalHint[section.key]" class="pg-privacy__hint">{{ PRIVACY_COPY.optionalHint[section.key] }}</text>
          <PgFold :title="PRIVACY_COPY.readAll" class="pg-privacy__more"><text class="pg-privacy__body">{{ section.body }}</text></PgFold>
        </PgCard>
      </template>
    </view>
  </AppShell>
</template>

<style scoped>
.pg-privacy__policy { color: var(--accent-text); font-size: var(--fs-13); font-weight: var(--fw-bold); line-height: 1.5; }
.pg-privacy { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
.pg-privacy__intro { display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-privacy__version { color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); line-height: 1.4; }
.pg-privacy__explain { color: var(--ink-2); font-size: var(--fs-13); line-height: var(--lh-body); }
.pg-privacy__item { display: flex; flex-direction: column; gap: var(--sp-1); }
.pg-privacy__head { display: flex; align-items: center; gap: var(--sp-2); min-height: var(--touch); }
.pg-privacy__name { flex: 1; min-width: 0; color: var(--ink); font-size: var(--fs-15); font-weight: var(--fw-black); line-height: 1.35; }
.pg-privacy__hint { color: var(--ink-2); font-size: var(--fs-13); line-height: 1.5; }
.pg-privacy__more { color: var(--accent-text); }
.pg-privacy__body { display: block; padding: var(--sp-3); border-radius: var(--radius-12); background: var(--paper-2); color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
