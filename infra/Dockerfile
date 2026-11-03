FROM node:24-slim

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
