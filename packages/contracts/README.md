# @proof-gym/contracts

`10-开发文档/contracts/` 的只读同步副本，由 `node tools/sync-contracts.mjs` 生成。

- 唯一源：`证明陪练场_产品设计工作区/10-开发文档/contracts/`；本目录不要手改。
- `pnpm check:contracts` 先跑 `sync-contracts --check`，再在源目录跑契约门禁。
- `gen/` 由 `pnpm gen:types` 生成（OpenAPI / JSON Schema 的 TypeScript 类型），不是契约数据。
- 服务端用 `@proof-gym/contracts/openapi.yaml` 与 `schema.sql`；前端读 `keyboard-layout.json` 和 `openapi.yaml`。
