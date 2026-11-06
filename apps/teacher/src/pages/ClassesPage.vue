<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { MessagePlugin } from 'tdesign-vue-next';

import { api, ApiError } from '../api/client.ts';
import type { ClassSummary } from '../api/types.ts';
import ClassCard from '../components/ClassCard.vue';

const router = useRouter();

const classes = ref<ClassSummary[]>([]);
const loading = ref(false);
const error = ref('');
const dialogVisible = ref(false);
const creating = ref(false);
const form = ref({ name: '', term: '2026 秋' });

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    classes.value = await api.get<ClassSummary[]>('/api/v1/teacher/classes');
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '加载班级失败';
  } finally {
    loading.value = false;
  }
}

async function create(): Promise<void> {
  if (form.value.name.trim() === '' || form.value.term.trim() === '') {
    MessagePlugin.warning('请填写班级名和学期');
    return;
  }
  creating.value = true;
  try {
    const created = await api.post<ClassSummary>('/api/v1/teacher/classes', {
      name: form.value.name.trim(),
      term: form.value.term.trim(),
    });
    MessagePlugin.success(`已建班，邀请码 ${created.inviteCode}`);
    dialogVisible.value = false;
    form.value.name = '';
    await refresh();
  } catch (caught) {
    MessagePlugin.error(caught instanceof ApiError ? caught.message : '建班失败');
  } finally {
    creating.value = false;
  }
}

function openClass(row: ClassSummary): void {
  void router.push(`/classes/${row.classId}`);
}

onMounted(refresh);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>我的班级</h2>
      <t-button theme="primary" @click="dialogVisible = true">建班</t-button>
    </div>
    <div class="page-sub">建班后把邀请码发给学生；名单导入在班级页的“名单”标签。</div>

    <t-alert v-if="error" theme="error" :message="error" />

    <div v-if="classes.length > 0" class="class-grid" data-testid="class-grid">
      <ClassCard v-for="c in classes" :key="c.classId" :item="c" @open="openClass" />
    </div>
    <div v-else-if="!loading" class="empty">还没有班级。点右上角“建班”，再导入名单、发邀请码、布置第一道题。</div>
    <t-loading v-else />

    <t-dialog
      v-model:visible="dialogVisible"
      header="建班"
      :confirm-btn="{ content: '创建', loading: creating }"
      @confirm="create"
    >
      <t-form label-width="70px">
        <t-form-item label="班级名">
          <t-input v-model="form.name" placeholder="如：数分 1 班" />
        </t-form-item>
        <t-form-item label="学期">
          <t-input v-model="form.term" placeholder="如：2026 秋" />
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<style scoped>
.class-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; margin-top: 12px; }
</style>
