# API · 前后端 Demo 接口文档（v2 六层版）

> 版本 v2.1 ｜ 日期 2026-10-31 ｜ 作者：产品设计（product-designer）｜ 阅读对象：前端/后端开发、技术评审、答辩
> 事实源：`SIX_LAYER_V2_CONTRACT.md`（v2 契约）+ `API_CONTRACT.md`（v1 基础约定）。本文按 **实际实现** 校准：`node tests/e2e.mjs` 实测 **111/111 PASS**、`server/server.mjs` 共 **27 条路由**。
> v2 变化：学生端从「P1–P6 十节点」升级为 **六层工作台**（前置知识点 → 题目解析 → 详细步骤 → 完整讲解 → 同类题 → 总结）；旧 `/review` 已停用（返回 409）；教师端/CSV/事件/运维接口保留不变。

---

## 0. 一页纸（白话版）

- **API** 是前端和后端说话的固定地址，全部以 `/api/` 开头，返回 JSON（CSV 除外）。
- **v2 的核心是六层**：每层一个提交端点，后端判定通过后把 `state.layer` 推进到下一层；没通过的层调用下一步端点会返回 409（「当前在第 N 层」）。
- **token** 是登录后的临时门禁卡：学生端接口要带 `Authorization: Bearer <token>`；token 存内存，服务重启后需重新登录。
- **错误统一格式**：`{ "error": { "code": "...", "message": "...", "detail": ... } }`；409=层不对/未解锁，429=预算用尽或次数用完。
- **演示账号**：邀请码 `MATH-A-2026`，学号任意非空；`studentId=demo` 直接进演示学生。
- **教师端接口**演示版不强制鉴权；只统计 36 名种子学生，演示学生 s-demo 的作答不计入班级数字。
- **AI 现状**：v2 为 mock（脚本 + 规则判定）；`DEEPSEEK_API_KEY` 目前只影响 `/api/health` 的 `mode` 字段，**v2 尚未接入真实模型调用**（见第 8.3 节待确认）。

---

## 1. 通用约定

| 项 | 约定 |
|---|---|
| Base URL | `http://127.0.0.1:8787`（`PORT` 可覆盖） |
| v2 标识 | `GET /api/health` → `{v2:true, version:"2.0.0"}`；`GET /api/meta` → `{v2:true, layers:[...]}` |
| 请求体 | `Content-Type: application/json`，UTF-8；上限 64KB |
| 认证 | `Authorization: Bearer <token>`（login/health/meta/admin/teacher 不校验；home/problems/attempts/events 校验） |
| 响应 | JSON；时间 ISO 字符串；新 ID 形如 `a-1f3c2b7d`、`e-...`；种子 attempt 用 `a001/a101/a201` |
| CSV | `GET /api/teacher/export.csv` → `text/csv; charset=utf-8`，UTF-8 BOM + CRLF，11 列 |
| 错误 | `{error:{code,message,detail?}}` + HTTP 状态码 |
| 数据边界 | 教师端只聚合 roster 内 36 名学生；`s-demo` 的演示作答不进入班级统计 |
| 层校验 | 每层端点先校验 `attempt.layer === 期望层`；不匹配 → 409 `WRONG_PHASE`（detail 含 `layer/expected`） |

**演示登录**

```http
POST /api/login
Content-Type: application/json

{"inviteCode":"MATH-A-2026","studentId":"demo"}
```

---

## 2. 端点总表（27 条，与 `/api/admin/routes` 一致）

| # | 方法 | 路径 | 用途（v2） | 鉴权 | 成功 |
|---|---|---|---|---|---|
| 1 | GET | `/api/health` | 健康检查：ok/mode/version/v2/数据条数 | 否 | 200 |
| 2 | GET | `/api/meta` | 元信息：邀请码、演示学生、六层定义、预算、路由 | 否 | 200 |
| 3 | POST | `/api/login` | 邀请码+学号登录，换 token | 否 | 200 |
| 4 | GET | `/api/home` | 首页：本周进度、继续上次（带 layer）、复测 | 是 | 200 |
| 5 | GET | `/api/problems` | 题库列表（筛选） | 是 | 200 |
| 6 | GET | `/api/problems/:id` | 题目详情（白名单，不含答案） | 是 | 200 |
| 7 | GET | `/api/problems/:id/knowledge` | 第 1 层：知识点卡（专业/高中/核对问题） | 是 | 200 / 409 |
| 8 | POST | `/api/attempts` | 开始/继续一次六层作答（`layer=1`） | 是 | 201 新建 / 200 继续 |
| 9 | GET | `/api/attempts/:id` | 恢复完整六层 state + messages | 是 | 200 |
| 10 | POST | `/api/attempts/:id/knowledge` | 第 1 层：提交复述 / 调取知识点卡 | 是 | 200 / 400 / 409 |
| 11 | POST | `/api/attempts/:id/parse` | 第 2 层：提交四栏解析，逐项查漏 | 是 | 200 / 400 / 409 |
| 12 | POST | `/api/attempts/:id/step` | 第 3 层：提交一步（结论+依据），返回三段式与 proactive | 是 | 200 / 400 / 409 |
| 13 | POST | `/api/attempts/:id/hint` | 第 3 层：L0–L4 提示（附 plain 白话） | 是 | 200 / 400 / 409 / 429 |
| 14 | POST | `/api/attempts/:id/answer-request` | 第 3 层：要答案 → 三段式拒绝 | 是 | 200 / 409 |
| 15 | POST | `/api/attempts/:id/xiaobai` | 小白解释三件套（≤2 次） | 是 | 200 / 429 |
| 16 | POST | `/api/attempts/:id/final` | 第 3 层收口：交终稿 → 覆盖表 → 第 4 层 | 是 | 200 / 400 / 409 |
| 17 | POST | `/api/attempts/:id/explain` | 第 4 层：学生讲，AI 五项核对 → 第 5 层 | 是 | 200 / 400 / 409 |
| 18 | GET | `/api/attempts/:id/variant` | 第 5 层：取同类题题面 | 是 | 200 / 409 |
| 19 | POST | `/api/attempts/:id/variant` | 第 5 层：提交变式题 → 第 6 层 | 是 | 200 / 400 / 409 |
| 20 | POST | `/api/attempts/:id/summary` | 第 6 层：三栏总结 → 总结卡/掌握度/完成 | 是 | 200 / 400 / 409 |
| 21 | GET | `/api/teacher/dashboard` | 教师看板聚合（v1 口径不变） | 演示版否 | 200 |
| 22 | GET | `/api/teacher/students/:studentId` | 学生详情（attempts+events） | 演示版否 | 200 |
| 23 | GET | `/api/teacher/export.csv` | 匿名 CSV（11 列） | 演示版否 | 200 |
| 24 | GET | `/api/events` | 事件流（?attemptId=&limit） | 是 | 200 |
| 25 | GET | `/api/admin/routes` | 端点清单（27 条） | 否 | 200 |
| 26 | GET | `/api/admin/stats` | 运维统计：mode/db/guard/最近事件 | 否 | 200 |
| 27 | POST | `/api/admin/reset` | 重置种子数据（并清空 guard 统计） | 否 | 200 |

> 旧 `POST /api/attempts/:id/review` 已停用：任意请求返回 `409 {code:"WRONG_PHASE", detail:{use:"/api/attempts/:id/summary"}}`。

---

## 3. 通用数据结构（v2 state）

### 3.1 state（作答类接口都返回；`GET /api/attempts/:id` 也返回）

```json
{
  "attemptId": "a-1f3c2b7d",
  "problemId": "p-cond-series",
  "layer": 3,
  "layerLabel": "详细步骤",
  "layerStatus": {"1":"done","2":"done","3":"active","4":"locked","5":"locked","6":"locked"},
  "guidance": {"title":"第 3 层 · 详细步骤（一步一依据）","instruction":"现在写第 1 步：…","placeholder":"结论/操作 + 依据（两步分开写也行）","submitLabel":"提交这一步","hintTip":"…"},
  "knowledge": {"requested":true,"question":"…","professional":"…","plain":"…","checkQuestion":"…","answer":"条件收敛就是级数本身收敛，但取绝对值后发散。","passed":true,"feedback":"定义抓到了…","attempts":1,"weakPoint":false},
  "parse": {"goal":"…","parts":"…","keywords":"…","tools":"…","plainRestatement":"这题让你判断：…","feedback":[],"passed":true},
  "steps": [{"no":1,"conclusion":"1/√(n+1) < 1/√n，{u_n} 单调递减","evidence":"因为 n+1 > n，所以分母变大，值变小。","status":"passed","feedback":"这一步站得住…","ts":"ISO"}],
  "stepIndex": 2,
  "failedAttempts": 0,
  "budgets": {"L1":3,"L2":3,"L3":2,"L4":1,"L0":6,"xiaobai":2},
  "used": {"L1":0,"L2":0,"L3":0,"L4":0,"L0":0,"xiaobai":0,"refusals":0},
  "unlocked": ["L0","L1"],
  "coverage": {"items":[],"covered":1,"total":5,"percent":20,"passed":false},
  "explanation": {"text":"","feedback":[],"passed":false},
  "variant": {"title":"变式题 · 绝对收敛","stem":"判断 ∑(−1)^(n−1)/n² 的收敛性…","answer":"","result":null},
  "summary": {"knowledge":"","difficulty":"","steps":"","feedback":[],"passed":false,"card":null},
  "independence": null,
  "mastery": null,
  "proactive": null,
  "finishedAt": null,
  "startedAt": "2026-10-31T06:00:00.000Z"
}
```

**前端规则**：预算/解锁/层状态一律用后端返回的 `budgets/used/unlocked/layerStatus` 渲染，不自己推算；刷新或换设备用 `GET /api/attempts/:id` 恢复。

### 3.2 guidance（本层任务卡配置）

```json
{"title":"第 4 层 · 完整讲解（你讲，AI 核对）","instruction":"完整讲解由你完成，AI 只核对缺口，不提供标准讲解。像给同学讲题一样讲一遍。","placeholder":"要证什么 → 分几段 → 每段依据 → 结论","submitLabel":"提交完整讲解","hintTip":"讲不清的地方就是没真懂的地方，AI 只指出缺口。"}
```

### 3.3 各层返回结构

| 层 | 关键字段 | 说明 |
|---|---|---|
| 1 knowledge | `passed, feedback, weakPoint, requested, state` | 复述合格或 2 次后带病前进（`weakPoint=true`） |
| 2 parse | `feedback:[{field,name,status,message}], passed, plainRestatement, state` | status = pass / missing；四栏全过才前进 |
| 3 step | `ai:{judge,hint,ask,tag}, diagnosis, step, stepPassed, proactive, state, guard` | 只指第一处可疑；连续失败 2 次`proactive`非空 |
| 3 hint | `level, text, tag, plain, state, guard` | `plain`=「这一步在干什么」的白话，不含结论/表达式 |
| 3 final | `coverage:{items[],covered,total,percent,passed}, passed, state, guard` | 只有 passed 才进入第 4 层 |
| 4 explain | `feedback:[{criterion,status,message}], passed, state, guard` | 五项：目标/结构/关键步骤/依据/结论；≥4 项通过 |
| 5 variant | GET `{variant:{title,stem},state}`；POST `{result:{correct,feedback},variant,state}` | 只判对错+一条追问 |
| 6 summary | `feedback:[{field,status,message}], passed, card, mastery, independence, state, guard` | 通过即写 `finishedAt`，六层全 done |

### 3.4 其他通用结构

```json
// diagnosis（第 3 层）
{"verdict":"suspect","firstError":1,"type":"需要修改","confidence":0.8,"note":"这里可能是第一处可疑：还差关键一步/条件。"}
// proactive（连续失败 ≥2 次，仅第 3 层）
{"offer":true,"level":"L2","text":"要不要先给一个方向提示？不会给答案。"}
// guard
{"ok":true,"blocked":false,"rules":[]}
// softLanding（429 时同时出现在 error.detail 与顶层）
{"options":[
  {"id":"l0","label":"只做 L0 追问","desc":"不再给新信息，只问依据"},
  {"id":"definition","label":"看定义卡","desc":"只给定义/定理原文"},
  {"id":"easier","label":"换同知识点更简单题","desc":"换一道更小的问题继续"},
  {"id":"teacher","label":"转教师","desc":"保存草稿，生成教师工单"}
]}
// refusal（要答案）
{"receive":"理解，你想快点看到完整过程。","rule":"但给了你整份证明…","alternatives":["看定义原文","二选一：先看开头，还是先看卡点","只点评我这一步","转给老师"],"alternativeDetails":[…]}
// 小白解释卡
{"concept":"条件收敛","analogy":"靠正负抵消才收敛，符号一去掉就撑不住。","example":"1−1/2+1/3−… 会稳住；1+1/2+1/3+… 越加越大。","formal":"∑a(n) 收敛且 ∑|a(n)| 发散，就叫条件收敛。","ask":"用你自己的话复述一遍，再回到题目。"}
```

---

## 4. 端点详解（请求/响应示例）

### 4.1 基础

**GET /api/health**

```json
{"ok":true,"mode":"mock","version":"2.0.0","v2":true,"uptimeSec":42,
 "db":{"students":36,"problems":12,"attempts":60,"events":337}}
```

**GET /api/meta**

```json
{"v2":true,"version":"2.0.0","inviteCodes":["MATH-A-2026"],"demoStudentId":"demo",
 "demoStudent":{"id":"s-demo","sid":"demo","name":"演示同学","className":"数学分析 A 班"},
 "layers":[{"n":1,"key":"knowledge","label":"前置知识点","sub":"专业 + 高中"},{"n":2,"key":"parse","label":"题目解析","sub":"你拆，AI 查漏"}],
 "phases":[{"key":"P1","label":"知识激活"}],
 "budgets":{"L1":3,"L2":3,"L3":2,"L4":1,"L0":6,"xiaobai":2},
 "routes":[{"method":"GET","path":"/api/health","desc":"健康检查（ok/mode/version/uptime/db）"}]}
```

**POST /api/login**

```json
// 请求
{"inviteCode":"MATH-A-2026","studentId":"demo"}
// 响应 200
{"token":"t-8f2a1c9d7e6b5a43","student":{"id":"s-demo","sid":"demo","name":"演示同学","className":"数学分析 A 班"}}
```

规则同 v1：邀请码错 401 INVALID_INVITE；学号空 400；token 存内存，重启失效。

**GET /api/admin/routes** → 27 条端点清单（与第 2 节一致）。
**GET /api/admin/stats** → `{mode,uptimeSec,db,guard:{checked,blocked,byRule},recentEvents}`。
**POST /api/admin/reset** → `{ok:true,reseededAt}`（重新 seed + 清空 guard 统计）。

### 4.2 学生端

**GET /api/home**

```json
{"student":{"id":"s-demo","name":"演示同学","className":"数学分析 A 班"},
 "weekly":{"required":3,"done":0,"percent":0},
 "continue":null,
 "retest":{"date":"2026-11-28","days":28},
 "counts":{"completed":0,"inProgress":0,"hintRounds":0}}
```

> `continue` 若有未完成作答：`{attemptId,problemId,title,layer,phase}`（v2 用 `layer` 而不是 node）。

**GET /api/problems?difficulty=mid** → `{total, items:[{id,title,chapter,kp,difficulty,type,estimatedMin,stem,status,available}]}`。
**GET /api/problems/:id** → 同结构单条（白名单：不含 keySteps/hints/referenceProof/script）。

**GET /api/problems/:id/knowledge**（第 1 层知识点卡）

```json
{"problemId":"p-cond-series",
 "question":"条件收敛和收敛的区别是什么？",
 "professional":"若 ∑a_n 收敛且 ∑|a_n| 发散，则称 ∑a_n 条件收敛。交错级数用莱布尼茨判别法：u_n 单调递减且 u_n→0 时收敛。",
 "plain":"原级数能收敛，但把每项都变成正数后就不收敛了。",
 "checkQuestion":"条件收敛与收敛的区别是什么？"}
```

错误：题目不存在 404；未发布（status!==published）409 WRONG_PHASE。

**POST /api/attempts**

```json
// 请求
{"problemId":"p-cond-series"}
// 响应 201（新建）或 200（继续已有未完成作答）
{"attemptId":"a-1f3c2b7d","problem":{"id":"p-cond-series","title":"…","stem":"…","available":true},"state":{ "...": "见 3.1" }}
```

未发布题：409 `{code:"WRONG_PHASE",message:"该题还在审核中，暂不可做",detail:{problemId}}`。

**GET /api/attempts/:id**（刷新恢复）

```json
{"attempt":{"id":"a-1f3c2b7d","attemptId":"a-1f3c2b7d","studentId":"s-demo","problemId":"p-cond-series",
  "layer":3,"layerStatus":{"1":"done","2":"done","3":"active","4":"locked","5":"locked","6":"locked"},"phase":"P3",
  "startedAt":"ISO","finishedAt":null,"independence":null,"mastery":null,
  "budgets":{"L1":3},"used":{"L1":0},"unlocked":["L0","L1"],"steps":[],"coverage":{"covered":0,"total":5,"percent":0,"passed":false}},
 "problem":{"id":"p-cond-series","title":"…","stem":"…"},
 "state":{" "...": "见 3.1"},
 "messages":[{"role":"ai","content":{"judge":"…","hint":"…","ask":"…"},"tag":"L0 追问","ts":"ISO"}]}
```

**第 1 层 POST /api/attempts/:id/knowledge**

```json
// 请求 A：调取知识点卡
{"action":"request-card"}
// 响应 200
{"passed":false,"feedback":"知识点卡在左栏（专业 / 高中两 tab）…","state":{"...":"见 3.1"},"requested":true}

// 请求 B：提交复述
{"action":"answer","answer":"条件收敛就是级数本身收敛，但取绝对值后发散。"}
// 响应 200（合格 → layer 2；不合格 passed=false 停在 layer 1）
{"passed":true,"feedback":"定义抓到了：先收敛，再取绝对值看是否发散。进入第 2 层。","weakPoint":false,"state":{"layer":2,"knowledge":{"passed":true}}}
```

- 空答案 → 400「请先写下你自己的理解」；
- 第 2 次仍不合格 → 自动 `passed:true, weakPoint:true`（带病前进，记录薄弱点）；
- 当前不在第 1 层 → 409。

**第 2 层 POST /api/attempts/:id/parse**

```json
// 请求（四栏至少填一栏）
{"goal":"判断级数是否收敛，若是，是条件收敛还是绝对收敛。",
 "parts":"两件：先证收敛，再证绝对值级数发散。",
 "keywords":"交错级数、条件收敛、p 级数",
 "tools":"莱布尼茨判别法、p 级数判别法"}
// 响应 200
{"feedback":[
   {"field":"goal","status":"pass","name":"要证什么","message":"目标清楚：判断收敛性并区分条件/绝对。"},
   {"field":"parts","status":"pass","name":"要证几件事","message":"拆成了两件事，方向对。"}],
 "passed":true,"plainRestatement":"这题让你判断：原级数收不收；如果收，是条件收敛还是绝对收敛。","state":{"layer":3}}
```

- 四栏全过才 `passed:true` 并进第 3 层；缺栏 → `status:"missing"` 且停在第 2 层；
- 空四栏 → 400「四栏至少填一栏」；当前不在第 2 层 → 409。

**第 3 层 POST /api/attempts/:id/step**（核心）

```json
// 请求（两个字段；v1 的 {text} 仍兼容，会被当作 conclusion）
{"conclusion":"1/√(n+1) < 1/√n，{u_n} 单调递减","evidence":"因为 n+1 > n，所以分母变大，值变小。"}
// 响应 200
{"ai":{"judge":"「1/√(n+1) < 1/√n」这一步站得住，依据也写了。","hint":"下一步：说明 u_n 的极限为 0。","ask":"lim 1/√n 为什么等于 0？","tag":"L0 肯定 · 给一步就交还"},
 "diagnosis":{"verdict":"ok","firstError":null,"type":"可以","confidence":0.9,"note":"这一步站得住…"},
 "step":{"no":1,"conclusion":"…","evidence":"…","status":"passed","feedback":"…"},
 "stepPassed":true,
 "proactive":null,
 "state":{"layer":3,"steps":[…],"stepIndex":2,"coverage":{"covered":1,"total":5,"percent":20,"passed":false}},
 "guard":{"ok":true,"blocked":false,"rules":[]}}
```

- 结论/依据都空 → 400「先写这一步的『结论/操作』」；
- 当前不在第 3 层 → 409（detail.layer/expected）；
- 连续失败 2 次 → `proactive:{offer:true,level:"L2",text:"要不要先给一个方向提示？不会给答案。"}`；
- 写对 → `steps[]` 增加/更新为 passed、`stepIndex+1`、coverage 重新计算；写错 → 该步 status=revision、`failedAttempts+1`；
- 5 步都写对后再提交 → `stepPassed:true` + `ai.tag:"L0 · 步骤完成"`，提示去交终稿。

**第 3 层 POST /api/attempts/:id/hint**

```json
// 请求（L0–L4；L0 不占信息型预算）
{"level":"L2"}
// 响应 200
{"level":"L2","text":"收敛这一半：交错级数有现成判别法，它的条件你逐条核对了吗？","tag":"L2 方向提示",
 "plain":"你正在写第 1 步（u_n=1/√n 单调递减）：先写结论，再补一句依据；AI 只指第一处可疑。",
 "state":{"used":{"L2":1},"unlocked":["L0","L1","L2"]},"guard":{"ok":true,"blocked":false,"rules":[]}}
```

- 未解锁 → 409 `HINT_LOCKED`（detail: level/unlocked/reason）；
- 预算用尽 → 429 `BUDGET_EXHAUSTED`（`softLanding` 同时在 error.detail 与顶层）；
- 当前不在第 3 层 → 409。

**第 3 层 POST /api/attempts/:id/answer-request**

```json
{"refusal":{"receive":"理解，你想快点看到完整过程。","rule":"但给了你整份证明…","alternatives":["看定义原文","二选一：先看开头，还是先看卡点","只点评我这一步","转给老师"],"alternativeDetails":[…]},
 "state":{"used":{"refusals":1}},"guard":{"ok":true,"blocked":false,"rules":[]}}
```

**POST /api/attempts/:id/xiaobai**（任意层可用，≤2 次）

```json
// 请求
{"concept":"p 级数"}
// 响应 200
{"card":{"concept":"p级数","analogy":"p 级数像一场「分母长得多快」的比赛…","example":"∑1/n²（p=2）收敛；∑1/n（p=1）发散。","formal":"p 级数 ∑1/n^p：p>1 收敛，0<p≤1 发散。","ask":"这里的 p 是多少？按规则它收敛还是发散？说一句再回题目。"},"state":{},"remaining":1}
```

第 3 次 → 429 `XIAOBAI_LIMIT`（detail: used/limit）。

**第 3 层收口 POST /api/attempts/:id/final**

```json
// 请求（通常由前端把「我的证明」拼成文本）
{"text":"① 令 u_n = 1/√n。因为 n+1 > n，所以 1/√(n+1) < 1/√n，即 {u_n} 单调递减。② …"}
// 响应 200
{"coverage":{"covered":4,"total":5,"percent":80,"passed":true,
  "items":[{"id":"k1","question":"你有没有用 n 和 n+1 写一个不等式，证明 u_{n+1}<u_n？","covered":true}]},
 "passed":true,"state":{"layer":4,"layerStatus":{"3":"done","4":"active"}},
 "guard":{"ok":true,"blocked":false,"rules":[]}}
```

- 覆盖 <80% → 200 + `passed:false`，**不前进**；
- 空终稿 → 400；当前不在第 3 层 → 409。

**第 4 层 POST /api/attempts/:id/explain**（学生讲，AI 五项核对）

```json
// 请求
{"text":"这道题要判断级数是否收敛，若是，是条件收敛还是绝对收敛。先证原级数收敛，再证绝对值级数发散。关键步骤是：用不等式说明单调递减，说明极限为 0，由莱布尼茨判别法得收敛。因为 p≤1 所以发散。结论是条件收敛。"}
// 响应 200（通过 → 第 5 层）
{"feedback":[
   {"criterion":"目标","status":"pass","message":"讲到「目标」了。"},
   {"criterion":"结构","status":"pass","message":"讲到「结构」了。"},
   {"criterion":"关键步骤","status":"pass","message":"讲到「关键步骤」了。"},
   {"criterion":"依据","status":"pass","message":"讲到「依据」了。"},
   {"criterion":"结论","status":"pass","message":"讲到「结论」了。"}],
 "passed":true,"state":{"layer":5},"guard":{"ok":true,"blocked":false,"rules":[]}}
```

- 五项中通过 ≥4 项才会 pass（约等于 80%）；缺哪项给 `status:"missing"` + 补法；
- 空讲解 → 400；当前不在第 4 层 → 409；**AI 不返回任何标准讲解/参考证明**。

**第 5 层 GET/POST /api/attempts/:id/variant**

```json
// GET 响应
{"variant":{"title":"变式题 · 绝对收敛","stem":"判断 ∑(−1)^(n−1)/n² 的收敛性，并说明是条件收敛还是绝对收敛。"},"state":{"layer":5}}
// POST 请求
{"answer":"绝对收敛，因为 1/n² 是 p=2>1 的 p 级数。"}
// POST 响应 200（正确 → 第 6 层）
{"result":{"correct":true,"feedback":"对了：1/n² 是 p=2>1 的 p 级数，所以绝对收敛。追问：如果换成 n 的一次方，结论会变吗？"},
 "variant":{"title":"变式题 · 绝对收敛","stem":"…"},
 "state":{"layer":6,"layerStatus":{"5":"done","6":"active"}}}
```

- 答错 → 200 + `correct:false`，停在第 5 层；GET/POST 都要在第 5 层，否则 409；空答案 400。

**第 6 层 POST /api/attempts/:id/summary**（完成）

```json
// 请求
{"knowledge":"条件收敛：原级数收敛，取绝对值后发散。",
 "difficulty":"最容易错的是莱布尼茨判别法的单调性条件。",
 "steps":"先核对单调递减，再确认极限为 0，然后用判别法，最后补绝对值发散。"}
// 响应 200
{"feedback":[
   {"field":"knowledge","status":"pass","message":"这一栏可以。"},
   {"field":"difficulty","status":"pass","message":"这一栏可以。"},
   {"field":"steps","status":"pass","message":"这一栏可以。"},
   {"field":"keywords","status":"pass","message":"这一栏可以。"}],
 "passed":true,
 "card":{"title":"我的总结卡 · 莱布尼茨判别法","items":["知识点：…","重难点：…","步骤：…"]},
 "mastery":89,
 "independence":"semi",
 "state":{"layer":6,"layerStatus":{"1":"done","2":"done","3":"done","4":"done","5":"done","6":"done"},"finishedAt":"ISO"},
 "guard":{"ok":true,"blocked":false,"rules":[]}}
```

- 三栏都空 → 400「三栏至少写一栏」；三栏不齐/关键词不足 → 200 + `passed:false`，不完成；
- 通过 → 写 `finishedAt`、算掌握度与独立性三档（独立=仅 L0 / 半独立=L1–L2 / 依赖=L3–L4 或粘贴）；
- 当前不在第 6 层 → 409。

### 4.3 教师端（v1 口径不变）

**GET /api/teacher/dashboard?period=week**

```json
{"period":"week","class":{"id":"c-math-a","name":"数学分析 A 班","term":"2026 秋","size":36},
 "kpis":{"completionRate":0.72,"completionRatePercent":72,"finished":26,"total":36,"unfinished":10,
   "avgHintRounds":4.8,"avgHintRoundsBasis":"同题口径：全部作答的 L1–L4 平均次数",
   "independence":{"independent":0.38,"semi":0.34,"dependent":0.28,"counts":{"independent":19,"semi":17,"dependent":14},"percent":{"independent":38,"semi":34,"dependent":28}}},
 "stuckTop5":[{"kp":"莱布尼茨的单调性条件","count":32,"percent":32}],
 "unfinishedList":[{"studentId":"s34","anonId":"匿名-34","inactiveDays":18,"inactiveWeeks":2}],
 "students":[{"studentId":"s01","anonId":"匿名-01","finished":3,"hints":12,"independence":"semi","independenceLabel":"半独立"}],
 "reviewQueue":[{"problemId":"p-integral-mean","title":"练习 · 积分中值定理","status":"pending"}],
 "exportUrl":"/api/teacher/export.csv","generatedAt":"ISO"}
```

**GET /api/teacher/students/:studentId** → student/summary/attempts/events（结构同 v1）。
**GET /api/teacher/export.csv** → 11 列、UTF-8 BOM、默认匿名：

```text
﻿匿名ID,班级,题号,知识点,开始时间,用时分钟,提示次数,最高提示级别,独立性,完成,覆盖度
匿名-01,数学分析 A 班,p-cond-series,莱布尼茨判别法;条件收敛;p级数,2026-10-30T06:12:00.000Z,22,3,L2,semi,1,100%
```

**GET /api/events?attemptId=&limit=50** → `{total, items[]}`（事件类型 v2 新增 `knowledge/parse/explain/summary/knowledge_card/finish` 等）。

### 4.4 旧接口兼容

| 旧接口 | v2 状态 |
|---|---|
| `POST /api/attempts/:id/review` | **已停用**：返回 409 `WRONG_PHASE`，detail.use 指向 `/summary` |
| `POST /api/attempts/:id/final` | 保留，语义改为「第 3 层收口 → 第 4 层」 |
| `POST /api/attempts/:id/variant` | 保留，改为第 5 层入口/提交 |
| 教师端 / CSV / 事件 / 运维 | 全部保留，口径不变 |

---

## 5. 错误码表（v2）

| HTTP | code | 触发场景 | 前端应做什么 |
|---|---|---|---|
| 400 | BAD_REQUEST | 缺字段、JSON 非法、空输入、请求体 >64KB | toast + 保留输入 |
| 401 | UNAUTHORIZED | 学生端接口缺 token / token 失效（服务重启） | 回登录页重新登录 |
| 401 | INVALID_INVITE | 邀请码错误 | 提示「邀请码或学号不对，请找老师确认」 |
| 404 | NOT_FOUND | 题目/作答不存在，或接口不存在 | 提示并返回上一屏 |
| 409 | WRONG_PHASE | **层不对**（如第 1 层未过就提交解析）、题目未发布、旧 /review | 按 detail 引导回正确层；未发布题禁用开始 |
| 409 | HINT_LOCKED | 提示等级未解锁 | 灰按钮 + 「先提交一次尝试或先用上一级」 |
| 429 | BUDGET_EXHAUSTED | 某级提示到上限 | 展示软着陆四选一（`softLanding.options`） |
| 429 | XIAOBAI_LIMIT | 小白解释超过 2 次 | 置灰 + 建议知识点卡/换题/转教师 |
| 500 | INTERNAL | 服务内部异常 | toast「服务开小差了」+ 重试 |

> 409 的 `detail` 通常带 `{layer, expected}`（层不匹配）或 `{level, unlocked}`（提示未解锁），前端可直接用于提示文案。

---

## 6. PowerShell `Invoke-RestMethod` 六层全流程

> ⚠️ **中文编码坑（实测）**：Windows PowerShell 5.1 直接用 `-Body (`@{...} | ConvertTo-Json)` 发送中文时，服务端可能收到乱码（表现为复述/解析永远不通过）。**请先定义下面的 `PostJson` 助手**，把 JSON 转成 UTF-8 字节再发；PowerShell 7 一般无此问题，但用助手最稳。
> 另：PowerShell 里 `$home` 是只读自动变量，变量名用 `$homeRes` 之类；非交互环境下载文件加 `-UseBasicParsing`。

```powershell
$base = "http://127.0.0.1:8787"

# 关键助手：UTF-8 字节发送 JSON（解决 PS 5.1 中文乱码）
function PostJson($path, $obj, $hdr) {
  $json = $obj | ConvertTo-Json -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  return Invoke-RestMethod ("$base" + $path) -Method Post -Headers $hdr -ContentType "application/json; charset=utf-8" -Body $bytes
}

# 0) 健康检查（应看到 v2:true / version 2.0.0 / 种子 36-12-60）
Invoke-RestMethod "$base/api/health" | ConvertTo-Json -Depth 5

# 1) 登录
$login = PostJson "/api/login" @{ inviteCode = "MATH-A-2026"; studentId = "demo" } @{}
$hdr = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod "$base/api/home" -Headers $hdr | ConvertTo-Json -Depth 6

# 2) 开始一题（state.layer 应为 1）
$att = PostJson "/api/attempts" @{ problemId = "p-cond-series" } $hdr
$aid = $att.attemptId

# 3) 第 1 层：先看知识点卡，再提交复述
Invoke-RestMethod "$base/api/problems/p-cond-series/knowledge" -Headers $hdr | ConvertTo-Json -Depth 5
$k1 = PostJson "/api/attempts/$aid/knowledge" @{ action = "answer"; answer = "条件收敛就是级数本身收敛，但取绝对值后发散。" } $hdr
$k1.passed; $k1.state.layer   # 实测 True / 2

# 4) 第 2 层：四栏解析
$p1 = PostJson "/api/attempts/$aid/parse" @{
  goal = "判断级数是否收敛，若是，是条件收敛还是绝对收敛。"
  parts = "两件：先证收敛，再证绝对值级数发散。"
  keywords = "交错级数、条件收敛、p 级数"
  tools = "莱布尼茨判别法、p 级数判别法"
} $hdr
$p1.passed; $p1.state.layer   # 实测 True / 3

# 5) 第 3 层：先故意错 2 次 → 触发主动 offer；再用 L2；然后写对 4 步（覆盖 80%）
$bad = @{ conclusion = "分母变大"; evidence = "" }
$null = PostJson "/api/attempts/$aid/step" $bad $hdr
$sBad2 = PostJson "/api/attempts/$aid/step" $bad $hdr
$sBad2.proactive   # 实测 offer=True / level=L2
$hint = PostJson "/api/attempts/$aid/hint" @{ level = "L2" } $hdr
$hint.text; $hint.plain

$steps = @(
  @{ conclusion = "1/√(n+1) < 1/√n，{u_n} 单调递减"; evidence = "因为 n+1 > n，所以分母变大，值变小。" },
  @{ conclusion = "lim 1/√n = 0"; evidence = "因为 n^{1/2} 趋向 +∞，所以 1/√n 趋向 0。" },
  @{ conclusion = "由莱布尼茨判别法，该级数收敛"; evidence = "因为前两步满足判别法的条件。" },
  @{ conclusion = "∑1/√n 是 p=1/2 的 p-级数，故发散"; evidence = "因为 p≤1，p 级数发散。" }
)
foreach ($s in $steps) {
  $r = PostJson "/api/attempts/$aid/step" $s $hdr
  "stepPassed=$($r.stepPassed) stepIndex=$($r.state.stepIndex) coverage=$($r.state.coverage.percent)%"
}
# 实测输出：stepPassed=True ×4，stepIndex 2→5，coverage 20/40/60/80

# 6) 交终稿（把「我的证明」拼成文本）→ 进入第 4 层
$st = Invoke-RestMethod "$base/api/attempts/$aid" -Headers $hdr
$finalText = ($st.state.steps | ForEach-Object { "第 " + $_.no + " 步：" + $_.conclusion + "；依据：" + $_.evidence }) -join '；'
$fin = PostJson "/api/attempts/$aid/final" @{ text = $finalText } $hdr
$fin.passed; $fin.state.layer   # 实测 True / 4（4 步 = 80% 达标）

# 7) 第 4 层：学生讲（AI 只给五项 checklist）
$ex = PostJson "/api/attempts/$aid/explain" @{ text = "这道题要判断级数是否收敛，若是，是条件收敛还是绝对收敛。先证原级数收敛，再证绝对值级数发散。关键步骤是：用不等式说明单调递减，说明极限为 0，由莱布尼茨判别法得收敛。因为 p≤1 所以发散。结论是条件收敛。" } $hdr
$ex.feedback | ForEach-Object { $_.criterion + "：" + $_.status }
$ex.state.layer   # 实测 5

# 8) 第 5 层：取同类题 → 提交
Invoke-RestMethod "$base/api/attempts/$aid/variant" -Headers $hdr | ConvertTo-Json -Depth 4
$v = PostJson "/api/attempts/$aid/variant" @{ answer = "绝对收敛，因为 1/n² 是 p=2>1 的 p 级数。" } $hdr
$v.result.correct; $v.state.layer   # 实测 True / 6

# 9) 第 6 层：三栏总结 → 完成
$sm = PostJson "/api/attempts/$aid/summary" @{
  knowledge = "条件收敛：原级数收敛，取绝对值后发散。"
  difficulty = "最容易错的是莱布尼茨判别法的单调性条件。"
  steps = "先核对单调递减，再确认极限为 0，然后用判别法，最后补绝对值发散。"
} $hdr
$sm.passed; $sm.mastery; $sm.independence   # 实测 True / 89 / semi
($sm.state.layerStatus | ConvertTo-Json -Compress)   # 六层应全为 done

# 10) 教师端 / CSV / 事件 / 运维
Invoke-RestMethod "$base/api/teacher/dashboard?period=week" | ConvertTo-Json -Depth 6
Invoke-RestMethod "$base/api/teacher/students/s01" | ConvertTo-Json -Depth 6
Invoke-WebRequest "$base/api/teacher/export.csv" -OutFile "demo-export.csv" -UseBasicParsing
Invoke-RestMethod "$base/api/events?attemptId=$aid&limit=100" -Headers $hdr | ConvertTo-Json -Depth 5
Invoke-RestMethod "$base/api/admin/stats" | ConvertTo-Json -Depth 6
Invoke-RestMethod "$base/api/admin/reset" -Method Post
```

---

## 7. curl 示例（Windows 用 `curl.exe`）

```bash
# 健康检查 / 元信息（v2 标识）
curl.exe -s http://127.0.0.1:8787/api/health
curl.exe -s http://127.0.0.1:8787/api/meta

# 登录
curl.exe -s -X POST http://127.0.0.1:8787/api/login -H "Content-Type: application/json" -d "{\"inviteCode\":\"MATH-A-2026\",\"studentId\":\"demo\"}"

# 开始一题（TOKEN 换成登录返回）
curl.exe -s -X POST http://127.0.0.1:8787/api/attempts -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" -d "{\"problemId\":\"p-cond-series\"}"

# 第 1 层：知识点卡 / 提交复述
curl.exe -s http://127.0.0.1:8787/api/problems/p-cond-series/knowledge -H "Authorization: Bearer TOKEN"
curl.exe -s -X POST http://127.0.0.1:8787/api/attempts/ATTEMPT/knowledge -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" -d "{\"action\":\"answer\",\"answer\":\"级数本身收敛，取绝对值后发散\"}"

# 第 2 层：四栏解析
curl.exe -s -X POST http://127.0.0.1:8787/api/attempts/ATTEMPT/parse -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" -d "{\"goal\":\"判断收敛性与条件绝对\",\"parts\":\"先证收敛再证绝对值发散\",\"keywords\":\"交错级数、条件收敛\",\"tools\":\"莱布尼茨判别法\"}"

# 第 3 层：提交一步 / 提示 / 要答案（看 409/429 用 -i）
curl.exe -s -X POST http://127.0.0.1:8787/api/attempts/ATTEMPT/step -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" -d "{\"conclusion\":\"1/√(n+1)<1/√n\",\"evidence\":\"因为 n+1>n\"}"
curl.exe -i -X POST http://127.0.0.1:8787/api/attempts/ATTEMPT/hint -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" -d "{\"level\":\"L2\"}"
curl.exe -s -X POST http://127.0.0.1:8787/api/attempts/ATTEMPT/answer-request -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" -d "{}"

# 第 4–6 层：讲 / 变式 / 总结
curl.exe -s -X POST http://127.0.0.1:8787/api/attempts/ATTEMPT/explain -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" -d "{\"text\":\"这道题要判断级数是否收敛…结论是条件收敛。\"}"
curl.exe -s http://127.0.0.1:8787/api/attempts/ATTEMPT/variant -H "Authorization: Bearer TOKEN"
curl.exe -s -X POST http://127.0.0.1:8787/api/attempts/ATTEMPT/summary -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" -d "{\"knowledge\":\"条件收敛要证两件事\",\"difficulty\":\"单调性条件易漏\",\"steps\":\"先单调再极限再判别法\"}"

# 教师看板 / CSV / 运维
curl.exe -s "http://127.0.0.1:8787/api/teacher/dashboard?period=week"
curl.exe -s -o demo-export.csv "http://127.0.0.1:8787/api/teacher/export.csv"
curl.exe -s http://127.0.0.1:8787/api/admin/stats
```

---

## 8. 与实现的核对结果

### 8.1 已核对（后端 v2，`node tests/e2e.mjs` 111/111 PASS）

> 另用真实服务复核过一遍完整六层（PowerShell + UTF-8 字节发送）：`POST /attempts → layer1`、`/knowledge → layer2`、`/parse → layer3`、连续两次坏提交 → `proactive(offer=L2)`、`/hint L2 → plain`、4 步写对 → `coverage 80%`、`/final → layer4`、`/explain → layer5`、`/variant → layer6`、`/summary → passed / mastery 89 / independence semi / 六层全 done`；`/review` 返回 409。

| # | 核对项 | 结论 |
|---|---|---|
| 1 | 27 条路由与 `/api/admin/routes` 一致（含六层新端点） | 一致 |
| 2 | `health.version="2.0.0"`、`health.v2=true`；`meta.layers` 六层顺序正确 | 一致 |
| 3 | state 六层字段（layer/layerLabel/layerStatus/guidance/knowledge/parse/steps/stepIndex/failedAttempts/coverage/explanation/variant/summary/proactive/mastery/independence/finishedAt） | 一致（e2e 逐字段断言） |
| 4 | 层门禁：第 1 层未过提交解析 → 409 WRONG_PHASE；各层端点只接受本层请求 | 一致 |
| 5 | `/knowledge` 复述合格进第 2 层；2 次不合格带病前进 `weakPoint=true` | 一致 |
| 6 | `/parse` 四栏逐项 pass/missing，全过才进第 3 层 | 一致 |
| 7 | `/step` 只指第一处可疑；连续 2 次失败返回 proactive(L2)；文案不含「给答案」 | 一致 |
| 8 | `/hint` 额外返回 `plain`；支持 L0–L4；429 带 softLanding；未解锁 409 | 一致 |
| 9 | `/final` 覆盖 ≥80% 进第 4 层；`/explain` 五项 ≥4 通过进第 5 层 | 一致 |
| 10 | `/variant` GET/POST 只在第 5 层；答对进第 6 层；答错停留 | 一致 |
| 11 | `/summary` 三栏+关键词通过 → finishedAt/mastery/independence；六层全 done | 一致 |
| 12 | `/review` 旧接口 → 409 WRONG_PHASE（detail.use=/summary） | 一致 |
| 13 | 教师看板/学生详情/CSV 11 列/事件流/admin 统计与 v1 口径一致（72%/4.8/38-34-28/32-27-19-13-9） | 一致 |
| 14 | 题目详情/知识点卡/提示/反馈/总结卡均无 keySteps/hints/referenceProof | 一致（e2e 断言） |

### 8.2 与 v1 的兼容点

- `POST /step` 仍接受旧字段 `{text}`（会当作 `conclusion`），但 v2 前端用 `{conclusion,evidence}`；
- 教师端/CSV/事件/运维接口与 v1 完全相同；
- v1 的 10 节点演示路径在 v2 已不再驱动页面；如需对照，见 `DEMO_SCRIPT.md` 的「v1 兼容」小节与 `ARCHITECTURE.md` 第 6 节。

### 8.3 已知偏差 / 待确认

| # | 现象 | 说明 |
|---|---|---|
| 1 | v2 未接入真实模型 | `server.mjs` 无 `tryDeepSeek` 调用；设置 `DEEPSEEK_API_KEY` 只让 `/api/health.mode` 显示 `deepseek`，实际仍走 mock。若答辩要讲「可选真实模型」，需先接回或改文案（待 Lead 定）。 |
| 2 | `/api/problems/:id` 不再返回 `hasScript` | v2 用 `available = (status==='published')`；旧前端若依赖 hasScript 需改（v2 前端已不依赖）。 |
| 3 | 全部 12 题都可开始作答 | v2 不再限制「只有第 2 题有脚本」：已发布题都能进六层流程（判定基于题目 keySteps/knowledge），未发布题 409。属于 v2 扩展，与 v1「只开放第 1 题」不同。 |

---

## 9. v1 → v2 端点迁移对照

| 业务动作 | v1 | v2 |
|---|---|---|
| 提交一步 | `POST /step {text}`（十节点脚本） | `POST /step {conclusion,evidence}`（第 3 层，仍兼容 text） |
| 终稿核对 | `POST /final {text}`（覆盖表） | `POST /final {text}`（第 3 层收口，进第 4 层） |
| 五问复盘 | `POST /review {answers[5]}` | **停用** → `POST /explain {text}`（学生讲，五项 checklist） |
| 变式题 | `POST /variant {answer}` | `GET/POST /variant`（第 5 层） |
| 总结 | 变式后即完成 | `POST /summary {knowledge,difficulty,steps}`（第 6 层，完成） |
| 知识点/解析 | 无独立端点 | `GET /problems/:id/knowledge`、`POST /knowledge`、`POST /parse` |
| 提示 | `POST /hint {level}` | 同左 + 响应新增 `plain` |

---

## 10. 引用

- `SIX_LAYER_V2_CONTRACT.md`（v2 唯一事实源）
- `API_CONTRACT.md`（v1 基础约定与实现偏差记录）
- `ARCHITECTURE.md`（v2 架构、六层状态机、红线分层）
- `DEMO_SCRIPT.md`（v2 演示脚本）
- `../README.md`（启动、四 Tab、口径）
- `../../03-产品设计/07-六层引导工作台规格.md`（六层产品规格）
- `../../03-产品设计/04-AI引导与提示阶梯规格.md`（L0–L4 与红线）
