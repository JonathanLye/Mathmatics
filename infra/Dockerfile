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
# 只安装 server / worker 及其工作区依赖的生产依赖：全量 --prod 会把学生端/教师端（uni-app、TDesign 等）的运行时依赖
# 也装进来（约 717MB），而它们的静态产物已在 web 阶段构建，运行时不需要。
RUN pnpm install --frozen-lockfile --prod --filter @proof-gym/server... --filter @proof-gym/worker... \
 && rm -rf /pnpm/store

ENV NODE_ENV=production
EXPOSE 3000
# 运行时不需要写 /app；用 node 镜像自带的非 root 用户。
# 唯一需要写的地方是照片落盘目录 STORAGE_DIR：在镜像里建好并归 node，compose 再把命名卷挂到同一路径
# （空命名卷首次挂载会继承镜像里该目录的属主，所以 node 能写）。
ENV STORAGE_DIR=/data/files
RUN mkdir -p /data/files && chown -R node:node /data
USER node
CMD ["node", "apps/server/src/server.ts"]

# ---------------------------------------------------------------- Caddy + 静态文件
# 学生端在 /（uni-app H5），教师端在 /t/（Vite base '/t/'）；/api 与 /health 反代 server。
FROM caddy:2 AS web
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-builder /app/apps/student/dist/build/h5 /srv/student
COPY --from=web-builder /app/apps/teacher/dist /srv/teacher

# ---------------------------------------------------------------- 共用主机变体（infra/shared）
# 只托管静态文件，监听 8080 明文 HTTP；TLS 与 /api 反代由主机 nginx 负责。
FROM caddy:2 AS web-shared
COPY infra/shared/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-builder /app/apps/student/dist/build/h5 /srv/student
COPY --from=web-builder /app/apps/teacher/dist /srv/teacher
