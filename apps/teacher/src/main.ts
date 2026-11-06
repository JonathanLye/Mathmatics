import { createApp } from 'vue';
import TDesign from 'tdesign-vue-next';
import 'tdesign-vue-next/es/style/index.css';
import 'katex/dist/katex.min.css';

import App from './App.vue';
import { router } from './router.ts';
import { initTheme } from './utils/theme.ts';
import './styles/theme.css';

// 先设好主题再挂载，避免先闪一下浅色。
initTheme();

createApp(App).use(TDesign).use(router).mount('#app');
