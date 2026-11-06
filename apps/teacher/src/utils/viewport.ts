import { computed, ref } from 'vue';

// 抽屉宽度：桌面固定，手机占满，避免超出屏幕（390px 时 760px 的抽屉内容会被裁掉）。
const width = ref(typeof window === 'undefined' ? 1280 : window.innerWidth);
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    width.value = window.innerWidth;
  });
}

export const drawerSize = computed(() => (width.value <= 820 ? '100%' : '760px'));
