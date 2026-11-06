import { defineConfig, type Plugin } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import path from 'node:path'

/**
 * uni 按相对 src 的路径给 chunk 命名，src 外的模块会变成 `..-node_modules-…`。
 * 名字以 `..` 开头时 Rollup 不补 `./`，动态 import 成了裸模块名，运行时加载失败
 * （撒花、手写压缩的 pako 兜底都因此失效），文件也成了隐藏文件。这里去掉这个前缀。
 */
function safeChunkNames(): Plugin {
  return {
    name: 'pg-safe-chunk-names',
    enforce: 'post',
    outputOptions(options) {
      const names = options.chunkFileNames
      if (typeof names !== 'function') return null
      return { ...options, chunkFileNames: (chunk) => names(chunk).replace(/(\.\.-)+/g, '') }
    },
  }
}

// #8：学生端接入 #6 的 pnpm workspace（@proof-gym/ui-math 为 workspace 依赖）。
// @ui-math 别名保留给源码内相对引用/测试使用，指向 workspace 包源码目录。
export default defineConfig({
  plugins: [uni(), safeChunkNames()],
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
