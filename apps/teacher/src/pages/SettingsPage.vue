<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { api } from '../api/client.ts';
import { clearSession, session } from '../stores/session.ts';

const router = useRouter();
const loggingOut = ref(false);
const me = computed(() => session.me);

async function logout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await api.post('/api/v1/auth/logout');
  } catch {
    // 会话已失效也允许退出
  } finally {
    clearSession();
    loggingOut.value = false;
    await router.push('/login');
  }
}
</script>

<template>
  <div>
    <div class="page-head"><h1>设置</h1></div>
    <div class="page-sub">账号信息与默认策略说明（04 §1）。默认策略目前按班级设置，在「布置」时随作业提交；管理员审批与 TOTP 待服务端接口。</div>

    <h4 style="margin-top: 18px">账号</h4>
    <t-table
      :data="me ? [{ key: '角色', value: me.role }, { key: '匿名码', value: me.anonCode }, { key: '显示名', value: me.displayName ?? '—' }] : []"
      :columns="[{ colKey: 'key', title: '项' }, { colKey: 'value', title: '值' }]"
      row-key="key"
      size="small"
    />

    <h4 style="margin-top: 18px">默认策略（04 §7）</h4>
    <t-alert
      theme="info"
      message="练习：求助开、拍照开、记录切出；测验：只 L3、求助关、拍照关、切出 3 次锁定、可设限时。当前在布置表单中逐次设置，不做全局默认。"
    />

    <div style="margin-top: 20px">
      <t-button theme="danger" variant="outline" :loading="loggingOut" @click="logout">退出登录</t-button>
    </div>
  </div>
</template>
