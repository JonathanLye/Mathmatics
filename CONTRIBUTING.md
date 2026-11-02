# 协作规则（CONTRIBUTING）

> 3 人（A/B/C）+ AI 编码代理 + PO/Lead。目标：`main` 永远可部署；契约与生成物不被误改；每个改动可追溯。

## 1. 角色与文件所有权

| 角色 | GitHub | 代码范围 | 主要职责 |
|---|---|---|---|
| A | `XuJinSheng1111111` | `apps/student/`、`packages/ui-math/` | 学生端、手写/键盘/MathText、微课与图解、学生侧 bug |
| B | `JonathanLye` | `apps/server/`、`packages/engine/`、`apps/worker/`、`packages/contracts/`、`infra/` | 服务端、引擎、事件、闸门、识别、导入 worker、部署与 CI |
| C | `lzjzj-creator` | `apps/teacher/`、`apps/import/`（或 `tools/import/`）、题库审核/导出 | 教师端、审核屏、导入界面、运营/管理页 |
| PO/Lead | `JonathanLye`（兼 B） | `10-开发文档/`、`.github/`、`CONTRIBUTING.md`、`AGENTS.md` | 需求与验收、老师/学校对接、issue 优先级、合并裁决 |

`.github/CODEOWNERS` 按上表自动请求评审。冲刺期每个路径都列三人（该区 owner 在前），作者以外任一人批准即可；作者自己的批准不算。

**契约变更**：`10-开发文档/contracts/` 只由 B 修改；PR 必须 B + A/C 至少一人评审；同时更新 `10-开发文档` 对应章节与生成物，并在 PR 附 `npm run check` 结果。字段只增不删（见 `contracts/README.md`）。

## 2. 任务：Issue 是执行单位，文档是规格

1. 每个可交付任务建 **一个 issue**（大任务拆 sub-issue），必须写：目标 / 范围 / 验收标准（DoD）/ 依赖 / 涉及文件。
2. issue 必须落 milestone（`Day0`–`Day3`/`P1`），加 labels：`type:*`、`area:*`、`priority:*`；被阻塞加 `status:blocked`，并在右侧 Relationships 里用 “Mark as blocked by” 关联前置 issue。
   - `type:feature` / `type:bug` / `type:docs` / `type:spike`
   - `area:student` / `area:server` / `area:teacher` / `area:contracts` / `area:content` / `area:infra`
   - `priority:P0` / `priority:P1`
3. 开发从 issue 创建分支；PR 描述里写 `Closes #<issue>`。
4. 不把任务清单复制进文档；文档只描述“是什么/为什么”，issue 记录“谁/何时/做到什么程度”。

## 3. 分支与提交

```text
main                         # 受保护，永远可部署
feat/a-<issue#>-<slug>       # A
feat/b-<issue#>-<slug>       # B
feat/c-<issue#>-<slug>       # C
fix/<owner>-<issue#>-<slug>
docs/<slug> / chore/<slug>
```

- 分支生命周期 ≤ 1 天；每天结束前合入或明确 blocked。
- 提交信息用 Conventional Commits：`feat(student): ...`、`fix(server): ...`、`docs: ...`；正文写动机与验证命令。
- 提交前本地跑：`cd "证明陪练场_产品设计工作区/10-开发文档/contracts" && npm run check`（改了契约/生成物时必跑）。

## 4. PR 规则

- 一个 PR 只做一件事；尽量 < 400 行 diff；标题 `[A][#12] 学生端做题页骨架`。
- PR 模板必填：改了什么 / 为什么 / 怎么验证 / 风险 / `Closes #`。
- 至少 1 个 approval；改了契约/引擎/基础设施必须有对应 owner 的 approval。
- CI 必须绿（`ci-gate`）；对话未解决不能合。
- CI 不强制分支与 main 同步（冲刺期少等一轮 CI）；但 main 上有契约/引擎新改动时，合并前先点 “Update branch”。
- 合并方式只用 **Squash**，合并后自动删分支；不 force push main。
- 可以开 auto-merge：批准 + CI 绿后自动合并。

**GitHub 侧强制（`main` 规则集 `main-protection`）**：必须 PR；1 个 approval；CODEOWNERS 路径需对应 owner 批准；`ci-gate` 必过；对话必须解决；只允许 squash；线性历史；禁止 force push 与删除分支。

**紧急绕过**：只有 Lead（admin）能在 PR 页勾选 “bypass rules” 直接合并，仍然必须开 PR，不能直推 main；只用于阻断上线的紧急修复，事后在 PR 里补一句原因（GitHub 会记审计日志）。
- 契约 PR 额外：三端影响、兼容性、回滚方式、`npm run check` 输出。

## 5. 评审 SLA 与节奏

- 评审 SLA：工作时间内 2 小时；当天 PR 当天合。
- 每日 10 分钟站会（文字即可）：昨天/今天/阻塞；阻塞写到 issue 并加 `status:blocked`。
- Day3 上午功能冻结后只修 P0；每次改动仍走 PR + CI。

## 6. 完成定义（DoD）

一个任务算完成，必须同时满足：

1. 验收标准逐条可验证（命令/截图/测试结果贴在 PR）。
2. 相关测试通过；契约改动跑过 `npm run check`。
3. 文档/接口/事件与实现一致；生成物已重生成。
4. 无明文密钥、无 `.env`、无大文件/版权 PDF 入库。
5. PR 已 review 并 squash 合入 main；issue 已关闭。

## 7. AI 编码代理

- 根目录 `AGENTS.md` 是给 AI 的硬约束；每个 app 可再加局部 `AGENTS.md`。
- AI 不得直接 push main；不得手改生成物；不得改契约而不更新文档/测试。
- 每个 issue 的 body 要给出上下文文件路径与 DoD，方便 AI 直接执行。

## 8. 安全与隐私

- 密钥只放 GitHub Secrets / 部署环境变量；不提交 `.env`、token、cookie。
- 学生数据/教辅 PDF/截图不入库；日志不打印学号、姓名、原始作答。
- 发现密钥泄露：立即轮换，删除日志，通知 Lead。
