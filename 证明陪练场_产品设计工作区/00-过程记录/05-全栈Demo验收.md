# 全栈 Demo 验收记录（前端 + 后端）

> 日期：2026-10-31 ｜ 验收人：Lead ｜ 结论：**通过，可演示**
> 位置：`06-前后端Demo/` ｜ 启动：双击 `06-前后端Demo/start-demo.cmd` → http://127.0.0.1:8787/

---

## 1. 交付形态

| 层 | 技术 | 位置 | 规模 |
|---|---|---|---|
| 前端 | 原生 HTML/CSS/JS（零依赖，四 Tab） | 06-前后端Demo/public/ | index.html 13KB + app.js 101KB + styles.css 34KB |
| 后端 | Node 24 内置模块（零 npm 依赖） | 06-前后端Demo/server/ | server.mjs 604 行 + ai/guard/seed/store/metrics 约 1000 行 |
| 数据 | JSON 文件持久化（首次自动 seed） | server/data/db.json（运行时生成） | 36 学生 / 12 题 / 60 attempts |
| 测试 | Node 原生断言（真实 HTTP） | 06-前后端Demo/tests/e2e.mjs | 107 条断言 |
| 文档 | README + API + 演示脚本 + 架构 | 06-前后端Demo/docs/ | 4 份约 73KB |

**默认 mock AI**：所有 AI 回复由后端脚本 + 规则生成；v2 未接线真实模型（`DEEPSEEK_API_KEY` 当前只改 health.mode 显示）。默认零外网、零 key 即可演示。

---

## 2. 后端验收

| 项 | 结果 | 证据 |
|---|---|---|
| E2E 测试 | **PASS 107 / 107，EXIT=0** | `cd 06-前后端Demo && node tests/e2e.mjs` |
| API 端点 | 22 个（基础 6 / 学生端 12 / 教师端 4） | /api/admin/routes |
| 学生端状态机 | 10 节点 P1–P6 全部可走通；节点 5 走 /hint、节点 7 走 /answer-request、节点 9/10 走 /final /review /variant | e2e 第三、四节 |
| 提示预算与解锁 | 服务端判定：初始仅 L0；未提交请求 L2 → 409 HINT_LOCKED；L1 用满 4 次 → 429 BUDGET_EXHAUSTED + 软着陆四选一；小白解释第 3 次 → 429 | e2e 第三节 |
| 防泄题闸门 | 六规则全部单测通过：BANNED_WORD / NUMBERED_STEPS / TOO_LONG / STEP_LEAK / REFERENCE_OVERLAP / CHAINED；blocked 返回 L0 兜底并写 leak_blocked 事件 | e2e 第八节 |
| 答案隔离 | GET /api/problems/:id 不含 keySteps / hints / referenceProof | e2e 第二节 |
| 教师端数据 | 完成率 72%（26/36）、未完成 10、平均提示 4.8、独立性三档 38/34/28、卡点 Top5 32/27/19/13/9 | e2e 第六节 |
| CSV 导出 | 200 + text/csv，11 列，默认匿名，60 行 roster | e2e 第六节 |
| 事件流 | /api/events 按 attemptId 过滤可用，事件写入与 attempt 一致 | e2e 第六节 |
| 重置 | POST /api/admin/reset 回到 36/12/60，教师端数字不变 | e2e 第七节 |

## 3. 前端验收（Chrome CDP 实测）

| 项 | 结果 | 证据 |
|---|---|---|
| 四 Tab / hash 路由 | ✅ ① 学生端 ② 教师端 ③ 后端与数据 ④ 说明；#/student、#/teacher、#/backend、#/about 直达 | 截图 fs-s1/fs-teacher/fs-backend/fs-about |
| 自动登录 | ✅ ?demo=1 自动 POST /api/login → S1 | fs-s1 |
| 学生端全链路 | ✅ S0→S1→S2→S3（10 节点）→S4（覆盖 5/5）→S5（节点 10/10、独立性「半独立 L1–L2」、掌握度 100、变式题正确） | fs-s1/s2/s3-node1/s3-chat/s4-coverage/s5-final |
| 关键交互 | ✅ 提示阶梯（后端解锁/预算）、三段式拒绝 + 替代动作、小白解释卡、覆盖表问句化、五问复盘 | fs-hint-modal、fs-refusal-modal、fs-s4-final |
| 教师端 | ✅ 72%/10/4.8/38-34-28、卡点 Top5、未完成名单、学生列表、过程摘要抽屉、导出 CSV、周/月切换 | fs-teacher |
| 后端面板 | ✅ health（mock、36/12/61/353）、22 条 routes、31 条请求日志（含状态/耗时）、事件流、guard 统计、reset | fs-backend |
| 无 JS 报错 | ✅ CDP 走查 errors=[]（仅 favicon 404，不影响） | QA 日志 |
| 390 宽适配 | ✅ iw=390、scrollWidth=390、越界元素=[]、无报错 | fs-mobile-s1/s2/s3/teacher/backend |
| 红线 | ✅ 走完整条链后 AI 区无「证毕/证明如下/答案是/综上/所以成立」；AI 三段式均由后端返回 | 截图 + CDP 文本检索 |

**自动走查脚本**：`00-过程记录/QA脚本/fs-walkthrough.mjs`（S0→S5 十节点 + 截图）、`fs-mobile.mjs`（390 模拟）。运行前先启动后端。

## 4. 截图索引（`00-过程记录/QA截图/`）

| 文件 | 内容 |
|---|---|
| fs-s1.png / fs-s2.png | 登录后的今日任务 / 选题 |
| fs-s3-node1.png / fs-s3-chat.png | 作答页初始 / 多轮三段式对话 |
| fs-hint-modal.png | 提示阶梯浮层（后端级别与剩余预算） |
| fs-refusal-modal.png | 「我要完整证明」三段式拒绝 + 替代动作 |
| fs-s4-final.png / fs-s4-coverage.png | 终稿输入 / 覆盖 5/5 问句表 |
| fs-s5-final.png | 完成页：掌握度 100、独立性三档、规律/自检卡/变式题 |
| fs-teacher.png | 教师端：72%/10/4.8/38-34-28、卡点 Top5、未完成名单 |
| fs-backend.png | 后端面板：health、guard 统计、22 端点、请求日志 |
| fs-mobile-*.png | 390×844 下的学生端/教师端/后端面板 |

## 5. 已知限制（在 Demo 中如实标注，不阻塞演示）

| # | 限制 | 原因 | 后续 |
|---|---|---|---|
| 1 | 题库审核队列只读，不落库 | 契约只定义 dashboard.reviewQueue 读接口 | 正式版加审核动作端点 |
| 2 | 规律/自检卡存 localStorage | 契约未定义落库端点 | 正式版加 S5 落库 |
| 3 | 变式题提交前题面用前端常量 | 契约未定义读取端点 | 正式版从种子/接口取 |
| 4 | 转教师/换小题是 UI 出口 | 未定义工单持久化 | 后续接工单系统 |
| 5 | 真实 DeepSeek 未接线 | v2 为 mock；`DEEPSEEK_API_KEY` 只改 health.mode | 11.7 后接回真实模型并过 guard |
| 6 | 演示版 token 内存态、attempt 未校验归属 | 演示简化 | 生产加签名/鉴权 |

## 6. 一句话结论

**后端 107 条 E2E 全过、前端四 Tab 真实调 API 全链路走通、手机 390 无溢出**——这套 Demo 已经能回答「学生怎么用、老师看什么、后端做了什么」三个问题，可以直接给罗老师/甲方演示。

> 演示脚本见 `06-前后端Demo/docs/DEMO_SCRIPT.md`；启动与 FAQ 见 `06-前后端Demo/README.md`。


---

## 7. v2 六层引导版追加验收（2026-10-31 15:55）

用户反馈 v1：六层看不清、不知道在哪提交、AI 像旁白、提示要自己找。v2 改造后追加验收：

| # | 检查项 | 结果 |
|---|---|---|
| V1 | 六层 stepper 显式可见 | ✅ 六个原名全部显示，当前层高亮、完成打勾（v2-l1/v2-l3-mid/v2-l6-done） |
| V2 | 每层大提交按钮 | ✅ 提交我的理解 / 提交我的解析 / 提交这一步 / 提交完整讲解 / 提交变式题 / 提交总结，输入区正下方；sticky 可见 |
| V3 | AI 教练常驻指令 | ✅ 右侧「现在请你做：…」随层/步骤变化；最新三段式反馈；提示按钮常驻 |
| V4 | 主动提示 offer | ✅ 第 3 层连续失败 2 次后，AI 教练主动弹「要不要给你一个方向提示？不会给答案」+ L2 按钮（v2-proactive.png） |
| V5 | 知识点卡专业/高中 | ✅ 默认隐藏，学生点「我忘了 / 没学过」后才出现；两 tab + 核对问题 |
| V6 | 完整讲解红线 | ✅ 第 4 层改为「学生讲，AI 五项 checklist 核对」，页面固定写「AI 不提供标准讲解」 |
| V7 | 六层全流程 | ✅ CDP 走完 L1→L2→L3（5 步）→L4→L5→L6：全部 done、总结卡/掌握度生成（v2-l6-done） |
| V8 | 后端 v2 | ✅ 27 路由、e2e **111/111 PASS**；/knowledge /parse /explain /summary /variant 全可用 |
| V9 | 390 手机 | ✅ 六层 stepper 2×3 换行；scrollWidth=390、越界元素=[]、无 JS 报错（v2-mobile-*） |
| V10 | 红线 | ✅ 全流程 AI 区无完整证明/最终答案；题目详情不含 keySteps/hints/referenceProof |

**v2 截图索引**：v2-l1.png（第1层）、v2-l2.png（第2层）、v2-l3-mid.png（第3层步骤+提交+AI教练）、v2-l3-hint.png（提示+小白版）、v2-l4.png（学生讲+五项checklist）、v2-l5.png、v2-l6-done.png（六层完成）、v2-proactive.png（主动提示）、v2-mobile-*.png、v2-teacher.png、v2-backend.png。

> 结论：v2 已直接回应用户四点反馈，可作为当前主演示版本；05 静态原型保留为离线流程版（顶部有 v2 指引）。
