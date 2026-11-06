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
    // 本地联调：客户端走同源 /api/v1（生产由 Caddy 反代），开发服务器把 /api 转给本机 server。
    // 目标可用 VITE_DEV_API_TARGET 覆盖；只在 dev server 生效，不影响构建产物。
    proxy: {
      '/api': { target: process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
  optimizeDeps: { include: ['katex'] },
})
