import { createApp } from 'vue';
import TDesign from 'tdesign-vue-next';
import 'tdesign-vue-next/es/style/index.css';

import App from './App.vue';
import { router } from './router.ts';
import './styles/theme.css';

createApp(App).use(TDesign).use(router).mount('#app');
