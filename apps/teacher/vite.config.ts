import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// 教师端本地开发：/api 代理到 server（默认 127.0.0.1:3000），避免跨源 + CORS（server 没有 CORS，05 §7）。
// 生产由 Caddy 把 /t/ 静态文件与 /api 同源提供（05 §8）。
// PG_API_TARGET / PG_TEACHER_PORT：本地并行起多套环境时改端口用，缺省保持 3000 / 5174。
const apiTarget = process.env.PG_API_TARGET ?? 'http://127.0.0.1:3000';
const port = Number(process.env.PG_TEACHER_PORT ?? 5174);

export default defineConfig({
  // 05 §8：生产由 Caddy 把 /t/ 指向教师端静态文件；API 仍走同源 /api。
  base: '/t/',
  plugins: [vue()],
  server: {
    port,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
});
