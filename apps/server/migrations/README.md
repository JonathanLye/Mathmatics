# 增量迁移

规则见 `10-开发文档/07-数据库设计.md` §8：

1. 每次改表写一个新文件 `NNNN_名字.sql`（从 `0001` 开始递增，只许小写字母、数字、下划线）。
2. 同时修改 `contracts/schema.sql`（唯一源）使它仍是最新全量结构，并 `node tools/sync-contracts.mjs`。
3. 迁移只加列、加表、加索引；写成可重复执行的形式（`IF NOT EXISTS`）更安全。
4. 新库会执行 `schema.sql` 并把本目录已有文件记为已应用；已有库只执行没记录过的文件。
5. 已经合入 main 的迁移文件不要再改，要改就新增一个。

执行：`pnpm db:migrate`（compose 里由一次性的 `migrate` 服务在 server 启动前执行）。
