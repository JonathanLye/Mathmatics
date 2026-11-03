import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import path from 'node:path'

// #8：学生端接入 #6 的 pnpm workspace（@proof-gym/ui-math 为 workspace 依赖）。
// @ui-math 别名保留给源码内相对引用/测试使用，指向 workspace 包源码目录。
export default defineConfig({
  plugins: [uni()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@ui-math': path.resolve(__dirname, '../../packages/ui-math/src'),
    },
  },
  server: {
    fs: { allow: [path.resolve(__dirname, '../..')] },
  },
  optimizeDeps: { include: ['katex'] },
})
