import { createSSRApp } from 'vue'
import App from './App.vue'
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/base.css'

export function createApp() {
  const app = createSSRApp(App)
  return { app }
}
