# 共用主机部署（与已有站点同机隔离）

面向“一台已经在跑别的站点的服务器”（2 核 / 3.5GiB，nginx 占 80/443，Docker 里已有其他容器）。独占服务器请用上一级的 `infra/docker-compose.yml`。

## 隔离设计（为什么这样写）

| 风险 | 做法 |
|---|---|
| 抢 80/443 | 不发布 80/443；只发布 `127.0.0.1:18080`（静态）和 `127.0.0.1:18081`（API） |
| 公网直连 | 回环端口公网不可达；防火墙本来也只放行 ESA 的 443 |
| 拖垮主机内存 | 每服务 `mem_limit`=`memswap_limit`（不占 swap），postgres 384MB + server 320MB + web 48MB，合计约 750MB；`oom_score_adj: 500` 让内核先杀我们 |
| 抢 CPU | `cpus` 上限 server 1.0 + postgres 0.75 + web 0.25；`cpu_shares: 128`（权重远低于默认 1024，主站进程有负载时优先，空闲时我们才用得满） |
| 日志写满根盘 | 每服务 json-file 10MB × 3 |
| 网络冲突 | 独立网络 `br-proofgym`，固定 `10.88.77.0/24` |
| 动到共享 Docker | 不改 `daemon.json`、不重启 dockerd（`live-restore` 关着，重启会停掉主站的 anubis 容器） |
| 主站 CSP 渗入 | nginx 新 server 块在 server 级写 `add_header`，不 include `security-headers.conf` |
| 登录限流把全班算一个 IP | nginx 直连 server 单跳；`/api` 不经过 Caddy |

## 绝对不要做

- `docker system prune`、`docker image prune -a`、`docker volume prune`：会删掉主站的回滚镜像。只允许 `docker compose -p proofgym ...` 与 `docker image rm proofgym-*`。
- `systemctl restart docker`、改 `/etc/docker/daemon.json`。
- 修改或删除 `/etc/nginx/conf.d/` 里已有的任何文件、改 firewalld。
- 在服务器上 `docker build` 或 `pnpm install`（内存会挤压主站）。
- 用 `network_mode: host`、发布 `0.0.0.0` 端口。

## 首次上线

前提：本机 Docker Desktop 已启动；子域名已加入 ESA 并解析（由你在控制台完成）；服务器上有 `infra/shared/` 目录内容。

每一步都标了对主站的影响。

1. **记录基线**（只读）。上线前后对比，确认主站未被改动：

   ```bash
   ssh bolimc-prod 'md5sum /etc/nginx/conf.d/*.conf > /root/nginx-conf-baseline.md5; docker ps --format "{{.Names}} {{.Status}}" > /root/docker-ps-baseline.txt; ss -ltn | sort > /root/ports-baseline.txt'
   ```

2. **本机构建并传镜像**（影响：服务器根盘 +约 2.1GB（server 镜像 1.39GB、postgres 642MB、web 100MB，写 `/var/lib/docker`；传输时压缩约一半），不启动容器）。先看 `df -h /` 剩余 ≥ 5GB：

   ```bash
   infra/shared/ship-images.sh bolimc-prod "$(git rev-parse --short HEAD)"
   ```

3. **放配置**（影响：无）。把 `docker-compose.yml`、`backup.sh` 放到服务器 `/var/www/proofgym/`（数据盘），`.env.example` 复制为 `.env` 并填写，`chmod 600 .env`。

4. **启动 compose**（影响：新增 3 个常驻容器（postgres、server、web）、一个一次性迁移容器和一个 bridge；用量见下）：

   ```bash
   cd /var/www/proofgym && TAG=<步骤 2 的 TAG> docker compose -p proofgym up -d
   TAG=<TAG> docker compose -p proofgym ps
   curl -s http://127.0.0.1:18081/health                                               # 公开：{ok,status,service}
   curl -s -H "x-health-token: $HEALTH_TOKEN" http://127.0.0.1:18081/health/details    # 明细：依赖、开关（.env 里的 HEALTH_TOKEN）
   ```

5. **导入种子题**（首次）：

   ```bash
   cd /var/www/proofgym && TAG=<TAG> docker compose -p proofgym run --rm migrate node apps/server/src/db/cli.ts seed
   ```

6. **nginx 阶段 1**（影响：主站 nginx 平滑 reload 一次）。把 `nginx-gym.conf.example` 的 80 端口块写成 `/etc/nginx/conf.d/<SUB>.conf`（先 `nginx -t`，通过才 reload）；然后签证书（与主站相同的 webroot 方式，只写 `/var/www/certbot` 与 `/etc/letsencrypt`）：

   ```bash
   certbot certonly --webroot -w /var/www/certbot -d <SUB>
   ```

   主站已有的 12 小时 cron 会自动续期并 reload nginx。
7. **nginx 阶段 2**：追加 443 块，`nginx -t` → `nginx -s reload`。
8. **冒烟**：`infra/smoke.sh https://<SUB>`，再用 `tools/model-ping.mjs` 探活模型密钥。
9. **对比基线**（只读）：`md5sum -c /root/nginx-conf-baseline.md5` 应只有新增文件；`docker ps` 里原有容器的状态没变。

## 后续更新（推荐：GHCR，不从本机上传）

本机上行带宽窄，`ship-images.sh` 只作为兜底（首次上线或 GitHub 不可用时）。日常更新走云端构建：合并到 `main` 后，工作流 `.github/workflows/publish-images.yml` 在 GitHub 上构建 server 与 web 镜像并推到 GHCR（`ghcr.io/<owner>/proofgym-server`、`proofgym-web`，标签 `sha-<提交前 8 位>` 与 `latest`），服务器自己拉取，几十秒完成。

**一次性准备**

1. 在 GitHub 创建只读令牌：Settings → Developer settings → Personal access tokens (classic)，只勾选 `read:packages`。
2. 在服务器上登录 GHCR。凭据放在独立目录，**不要**写进主站在用的 `/root/.docker/config.json`（里面有主站的阿里云镜像仓库凭据）。令牌在提示处粘贴，不要写进命令行参数：

   ```bash
   export DOCKER_CONFIG=/var/www/proofgym/.docker && mkdir -p "$DOCKER_CONFIG" && chmod 700 "$DOCKER_CONFIG"
   docker login ghcr.io -u <你的 GitHub 用户名>
   ```

3. 在 `/var/www/proofgym/.env` 里取消注释并设置 `SERVER_IMAGE`、`WEB_IMAGE`（和可选的 `POSTGRES_IMAGE`）。

**每次更新**

1. 合并到 `main`，等 Actions 里 “Publish images” 跑完，在运行摘要里看 `TAG`。
2. 在服务器上（只重建镜像变了的服务；迁移容器会先跑）：

   ```bash
   cd /var/www/proofgym && export TAG=sha-xxxxxxxx
   DOCKER_CONFIG=/var/www/proofgym/.docker docker pull ghcr.io/<owner小写>/proofgym-server:$TAG
   DOCKER_CONFIG=/var/www/proofgym/.docker docker pull ghcr.io/<owner小写>/proofgym-web:$TAG
   docker compose -p proofgym up -d
   ```

3. 回滚：用上一个 `TAG` 重复第 2 步。
4. 清理旧镜像只能按名字删：`docker image rm ghcr.io/<owner小写>/proofgym-server:<旧 TAG>`。不要 prune。

只改前端时，服务器只需拉 web 镜像；server 镜像的依赖层没变时，拉取也只下载变化的层。

## 资源与监控

```bash
docker stats --no-stream $(docker ps -q --filter label=com.docker.compose.project=proofgym)
free -h
```

`proofgym-*` 容器 RSS 持续接近 `mem_limit` 就说明上限偏低；这时被杀的是我们的容器，不是主站。先看日志再调上限，不要放开到主站拿不到内存。

## 回滚与停止

停服务不影响主站：

```bash
cd /var/www/proofgym && TAG=<TAG> docker compose -p proofgym down        # 保留数据卷
```

撤销 nginx：删除 `/etc/nginx/conf.d/<SUB>.conf` → `nginx -t` → `nginx -s reload`。数据卷 `proofgym_postgres_data`、`proofgym_server_data`（学生拍照原图，容器内 `/data/files`）仅在确认不要数据时用 `docker volume rm` 删除。

## 备份

`backup.sh` 只备份数据库，不含 `proofgym_server_data` 里的拍照原图（识别后的文字已在库里，原图丢失只影响回看）；`backup.sh` 依赖 compose 在运行；`BACKUP_DIR` 建议放数据盘（`/var/www/proofgym-backups`）。示例 cron：`0 */6 * * * BACKUP_DIR=/var/www/proofgym-backups /var/www/proofgym/backup.sh`。

## 已知局限

- 不部署 `worker`：仓库里的 worker 只是骨架，启动即退出；指标刷新在 server 进程内完成。

- 压测只在本机做过（`tools/loadtest.mjs 60 6`，60 名学生同时作答 + 教师刷新看板）：峰值内存 postgres 约 106MiB、server 约 90MiB；CPU 上限 server 1.0 / postgres 0.75 时教师看板 p95 约 0.5s，学生各接口 p95 均低于 0.5s。服务器是 2 核共用，实际表现要在服务器上低峰再压一遍（对 `127.0.0.1:18081`，同时观察 `free -h`）。注意 loadtest 在同一数据库上重复跑会因学号已记录年龄段而报 `AGE_BAND_LOCKED`、同 IP 登录超 120 次/分会 429，这不是部署问题。
- 单机单实例：Postgres 与应用同机，没有高可用。主机重启后容器会自动拉起（`restart: unless-stopped`），但中间有停机。
- 登录失败锁定在内存里，容器重启即清零（见 `login-throttle.ts`）。
