# 增量迁移

规则见 `10-开发文档/07-数据库设计.md` §8：

1. 每次改表写一个新文件 `NNNN_名字.sql`（从 `0001` 开始递增，只许小写字母、数字、下划线）。
2. 同时修改 `contracts/schema.sql`（唯一源）使它仍是最新全量结构，并 `node tools/sync-contracts.mjs`。
3. 迁移只加列、加表、加索引；写成可重复执行的形式（`IF NOT EXISTS`）更安全。
4. 新库会执行 `schema.sql` 并把本目录已有文件记为已应用；已有库只执行没记录过的文件。
5. 已经合入 main 的迁移文件不要再改，要改就新增一个。执行器会校验 `public.schema_migrations.sha256`，改了已记录文件会直接报错（旧版执行器留下的无 hash 记录，第一次遇到时补写）。
6. 整个迁移在一个事务里执行并持有 `pg_advisory_xact_lock`；失败整体回滚、不记录，修好后可重试。迁移事务内会临时 `set local statement_timeout = 0`（连接池默认 15s 不适合大表 DDL）；超大表的 `CREATE INDEX` 仍建议在低峰分批执行。
7. 不做 down 迁移。回退策略 = 迁移前按 `05 §8.3` 做 `pg_dump -Fc` 备份，失败时恢复备份；因此迁移前先确认备份已完成。
8. 执行器（本目录的 runner）要先于第一个真实迁移文件合入：合并顺序 `feat/b-migrations` → `feat/b-idempotency`。只合 runner 不会改变任何库结构。
9. 首次部署或迁移失败后手动重跑：`docker compose run --rm migrate node apps/server/src/db/cli.ts migrate`（compose 的一次性 `migrate` 服务在 server 之前执行；`restart` 策略为 `no`，失败需手动重跑并保留日志）。

执行：`pnpm db:migrate`（compose 里由一次性的 `migrate` 服务在 server 启动前执行）。
