# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- 前端构建（学生端 H5 + 教师端）
# 在镜像内构建静态产物，部署机只需 docker compose build/up（05 §8）；
# 学生端 build:prod 读 .env.production（VITE_USE_MOCK=false、关闭 mock 入口），走真实 API（#157）。
FROM node:24-slim AS web-builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@12.14.0

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
# 构建需要 devDependencies（uni-app / vite / vue-tsc 等），不能用 --prod。
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @proof-gym/student build:prod \
 && pnpm --filter @proof-gym/teacher build

# ---------------------------------------------------------------- 服务端 / worker 运行时
FROM node:24-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@12.14.0

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile --prod

ENV NODE_ENV=production
EXPOSE 3000
# 运行时不需要写 /app；用 node 镜像自带的非 root 用户。
USER node
CMD ["node", "apps/server/src/server.ts"]

# ---------------------------------------------------------------- Caddy + 静态文件
# 学生端在 /（uni-app H5），教师端在 /t/（Vite base '/t/'）；/api 与 /health 反代 server。
FROM caddy:2 AS web
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-builder /app/apps/student/dist/build/h5 /srv/student
COPY --from=web-builder /app/apps/teacher/dist /srv/teacher
