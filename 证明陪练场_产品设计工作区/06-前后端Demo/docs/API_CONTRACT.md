# 前后端 Demo · API 契约（团队唯一事实源）

> 版本 v1.0 ｜ 2026-10-31 ｜ 维护：Lead
> 目标：零外部依赖（只用 Node.js 内置模块 + 原生 HTML/CSS/JS），做出前端 + 后端都能演示的可运行 Demo。
> 目录：证明陪练场_产品设计工作区/06-前后端Demo/

---

## 0. 硬约束

1. 零依赖：不得 npm install，不得引 CDN/框架/字体/图片外链；Node 只用 node:http、node:fs、node:path、node:crypto、node:url。
2. 可双击启动：start-demo.cmd 启动 node server/server.mjs 并打开 http://127.0.0.1:8787/；端口可用 PORT 覆盖。
3. 数据落盘：server/data/db.json（首次启动自动 seed；DB_PATH 可覆盖，测试用临时文件）。
4. 服务端才是红线执行者：提示预算、解锁条件、防泄题闸门都在后端；前端只展示 budgets/unlocked/guard。
5. 学生端 AI 回复严格三段式 {judge,hint,ask}，正文 ≤130 字（L4 ≤200 字）。
6. 所有 API 返回 JSON（CSV 除外）；错误统一 {error:{code,message,detail?}}。
7. 演示账号：邀请码 MATH-A-2026，学号任意非空；studentId=demo 直接进。
8. 前端顶栏 Tab：① 学生端 ② 教师端 ③ 后端与数据 ④ 说明；支持 hash #/student、#/teacher、#/backend、#/about；支持 ?demo=1 自动登录。

---

## 1. 目录与写入范围

~~~ text
06-前后端Demo/
├─ README.md                 ← product-designer
├─ start-demo.cmd / .ps1     ← Lead
├─ server/                   ← tech-planner
│  ├─ server.mjs（export createServer；静态 + API）
│  ├─ store.mjs（JSON 持久化 + seed + reset）
│  ├─ seed.mjs（36 学生 / 12 题 / 种子 attempts）
│  ├─ ai.mjs（mock 状态机；可选 DeepSeek）
│  ├─ guard.mjs（export check(text, opts)）
│  ├─ metrics.mjs（教师看板聚合）
│  └─ data/db.json（运行时生成）
├─ public/                   ← demo-builder
│  ├─ index.html / app.js / styles.css
├─ tests/e2e.mjs             ← tech-planner（20+ 断言）
└─ docs/                     ← product-designer
   ├─ API.md / DEMO_SCRIPT.md / ARCHITECTURE.md
~~~

---

## 2. 数据模型（db.json）

~~~ json
{
  "meta": { "version": "1.0.0", "seededAt": "ISO", "mode": "mock" },
  "students": [{ "id":"s01","sid":"2026001","name":"王砚","className":"数学分析 A 班","group":"experiment","lastActive":"ISO" }],
  "problems": [{
    "id":"p-cond-series","title":"第 2 题 · 交错级数与条件收敛","chapter":"级数",
    "kp":["莱布尼茨判别法","条件收敛","p级数"],"difficulty":"mid","type":"required","estimatedMin":22,
    "stem":"判断级数 ∑_{n=1}^{∞} (−1)^{n−1}/√n 的收敛性；若收敛，是条件收敛还是绝对收敛？证明你的结论。",
    "keySteps":[
      {"id":"k1","text":"u_n=1/√n 单调递减","question":"你有没有用 n 和 n+1 写一个不等式，证明 u_{n+1}<u_n？"},
      {"id":"k2","text":"u_n→0","question":"lim 1/√n=0 的依据，你写的是结论还是推导？"},
      {"id":"k3","text":"由莱布尼茨判别法得收敛","question":"你有没有明确写出『由莱布尼茨判别法』这句话？"},
      {"id":"k4","text":"∑1/√n 发散（p=1/2≤1）","question":"∑1/√n 发散这一点，你引用了哪条现成结论？适用范围写清了吗？"},
      {"id":"k5","text":"结论：条件收敛","question":"结论里『条件收敛』四个字出现了吗？两半理由都在吗？"}
    ],
    "hints":{
      "L1":"这题的关键是莱布尼茨判别法。它有三个条件，你逐条核对了吗？",
      "L2":"收敛这一半：交错级数有现成判别法，它的条件你逐条核对了吗？",
      "L3":"示范一步：由 lim n^{1/2}=+∞ 得 lim 1/√n=0。下一句你补。",
      "L4":"先示范一行：1/√(n+1)<1/√n。剩下两个条件由你补，并用一句话复述理由。"
    },
    "referenceProof":"（仅服务端内部用于重合度检测，绝不下发）",
    "script":[{"node":1,"phase":"P1","rounds":[{"label":"用自己的话说：这道题要你证什么？","sample":"要证这个级数收敛，还要判断它是条件收敛还是绝对收敛。","tag":"L0 追问 · 不讲课","ai":{"judge":"先别动笔，你提到的「条件收敛」是这道题的眼。","hint":"定义我不替你写。","ask":"「条件收敛」的完整定义是什么？它比「收敛」多要求什么？"}}]}],
    "variant":{"title":"变式题 · 绝对收敛","stem":"判断 ∑_{n=1}^{∞} (−1)^{n−1}/n² 的收敛性，并说明是条件收敛还是绝对收敛。","answerKeywords":["绝对收敛","1/n²","p=2"]}
  }],
  "attempts":[{ "id":"a01","studentId":"s01","problemId":"p-cond-series","startedAt":"ISO","finishedAt":null,"phase":"P1","node":1,"round":0,
    "budgets":{"L1":3,"L2":3,"L3":2,"L4":1,"L0":6,"xiaobai":2},
    "used":{"L1":0,"L2":0,"L3":0,"L4":0,"L0":0,"xiaobai":0,"refusals":0},
    "unlocked":["L0"],"independence":null,"pasteFlags":0,"chat":[],"draft":[],
    "coverage":{"covered":0,"total":5,"percent":0,"items":[]},"finalText":"","review":null,"variantResult":null,"hintLog":[] }],
  "events":[{ "id":"e01","ts":"ISO","studentId":"s01","attemptId":"a01","type":"login","level":null,"text":"","meta":{},"durationMs":null }]
}
~~~

### 2.1 种子要求（教师端数字必须对上）

- 36 名学生，26 人完成本周必做（72%），10 人未完成，其中 3 人连续 2 周未动。
- 平均提示轮数 4.8；独立性三档 38% / 34% / 28%（不合成单一百分比）。
- 卡点知识点 Top5：莱布尼茨的单调性条件 32%、条件收敛的定义 27%、p 级数适用范围 19%、极限为 0 的依据 13%、五问复盘第 3 问 9%。
- 题 12 道：p-cond-series 完整脚本，其余 11 道有题面/关键步骤/提示；前端只完整开放第 1 道。
- 教师端尽量由 attempts 聚合，不要写死在前端。

---

## 3. 状态机

P1 知识激活 → P2 学生拆题 → P3 分步推进 → P4 终稿核对 → P5 五问复盘 → P6 迁移总结。

- 脚本题 script 共 10 个节点，每个 1–2 轮；POST /step 按节点/轮次返回三段式并推进。
- 节点 1–2 → P1/P2；节点 3–8 → P3；节点 9 → P4/P5；节点 10 → P6。
- 节点 5 提示、节点 7 要答案：前端调用专用 /hint、/answer-request，不调用 /step。
- 每次提交/提示/拒绝写 events；完成时判定 independence：只用 L0=independent；用 L1–L2=semi；用 L3–L4 或粘贴=dependent。

---

## 4. API 端点

除 login/health/meta/admin 外，均需 Authorization: Bearer <token>（演示版只校验 token 存在且能映射学生）。教师端接口演示版不强制鉴权。

### 4.1 基础

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | /api/health | — | ok, mode, version, uptimeSec, db{students,problems,attempts,events} |
| GET | /api/meta | — | inviteCodes, demoStudentId, phases, budgets, routes |
| POST | /api/login | {inviteCode,studentId} | {token, student:{id,sid,name,className}}；错邀请码 401 |
| GET | /api/admin/routes | — | [{method,path,desc}] |
| GET | /api/admin/stats | — | mode, uptimeSec, db, guard{checked,blocked,byRule}, recentEvents |
| POST | /api/admin/reset | — | {ok:true, reseededAt} |

### 4.2 学生端

| 方法 | 路径 | 请求 | 响应 |
|---|---|---|---|
| GET | /api/home | — | student, weekly{required,done,percent}, continue, retest, counts |
| GET | /api/problems?chapter=&kp=&difficulty=&type= | — | {total, items[]} |
| GET | /api/problems/:id | — | 题面白名单字段（不得含 keySteps/hints/referenceProof） |
| POST | /api/attempts | {problemId} | {attemptId, problem, state} |
| GET | /api/attempts/:id | — | {attempt, problem, state, messages} |
| POST | /api/attempts/:id/step | {text} | {ai:{judge,hint,ask,tag}, diagnosis, state, draft, guard} |
| POST | /api/attempts/:id/hint | {level:L1..L4} | 成功 {level,text,tag,state,guard}；409 HINT_LOCKED；429 BUDGET_EXHAUSTED + softLanding |
| POST | /api/attempts/:id/answer-request | {} | {refusal:{receive,rule,alternatives[]}, state, guard} |
| POST | /api/attempts/:id/xiaobai | {concept?} | {card:{analogy,example,formal,ask}, state}；>2 次 429 |
| POST | /api/attempts/:id/final | {text} | {coverage:{items[],covered,total,percent,passed}, state, guard} |
| POST | /api/attempts/:id/review | {answers[5]} | {feedback[], mastery, state} |
| POST | /api/attempts/:id/variant | {answer} | {variant, result{correct,feedback}, state}；完成后结束 attempt |

state 统一结构：

~~~ json
{ "attemptId":"a01","problemId":"p-cond-series","node":3,"phase":"P3","phaseLabel":"P3 分步推进",
  "budgets":{"L1":3,"L2":3,"L3":2,"L4":1,"L0":6,"xiaobai":2},
  "used":{"L1":1,"L2":0,"L3":0,"L4":0,"L0":2,"xiaobai":0,"refusals":0},
  "unlocked":["L0","L1","L2"], "independence":null,
  "draft":[{"tag":"第 1 步 · 单调性（你写的）","text":"…"}] }
~~~

ai 三段式：{judge,hint,ask,tag}；judge ≤25 字、ask 一个问句 ≤40 字、合计 ≤130 字（L4 ≤200），服务端 guard 校验后返回。

### 4.3 教师端

| 方法 | 路径 | 响应 |
|---|---|---|
| GET | /api/teacher/dashboard?period=week|month | period, class, kpis{completionRate,finished,total,unfinished,avgHintRounds,independence{independent,semi,dependent}}, stuckTop5[], unfinishedList[], students[], reviewQueue[], exportUrl |
| GET | /api/teacher/students/:studentId | student, summary, attempts[], events[] |
| GET | /api/teacher/export.csv | text/csv；列：匿名ID,班级,题号,知识点,开始时间,用时分钟,提示次数,最高提示级别,独立性,完成,覆盖度 |
| GET | /api/events?attemptId=&limit=50 | {total, items[]} |

### 4.4 错误码

400 BAD_REQUEST；401 UNAUTHORIZED/INVALID_INVITE；404 NOT_FOUND；409 HINT_LOCKED/WRONG_PHASE；429 BUDGET_EXHAUSTED/XIAOBAI_LIMIT。

---

## 5. 防泄题闸门（server/guard.mjs）

check(text, {level,maxLen,referenceProof,keySteps,history}) → {ok,blocked,rules,safeText?}

规则（命中任一即 blocked）：
1. 禁用词：证毕|证明如下|答案是|综上|故命题成立|所以命题成立|所以.*成立。
2. 编号/骨架：行首 ①-⑩、1./2.、或「首先…然后…最后」三连。
3. 长度：L0 30 / L1 60 / L2 80 / L3 120 / L4 200 / refusal 100；超限。
4. 关键步骤泄漏：包含 ≥2 条 keySteps[].text 的片段（≥6 字）。
5. 重合度：与 referenceProof 最长公共子串 ≥12 字。
6. 连读：最近 3 条 AI 提示拼接后命中 1/2/4。

blocked 后返回 L0 安全兜底句，写 leak_blocked 事件，响应 guard{ok:false,blocked:true,rules}。

---

## 6. Mock AI 引擎（server/ai.mjs）

- 输入 problem, attempt, action{type,text?,level?}。
- 脚本题按 script 节点/轮次返回预置三段式；/step 后 round++，轮次用尽 node++ 并更新 phase。
- 诊断轻量规则：太短→资料不足；无「因为/由于/由…得/依据/所以」→缺依据；节点 3 无不等式→首疑点缺不等式。
- 解锁：L0 随时；L1 需当前节点提交≥1；L2 需 L1 已用或连续失败≥2；L3 需 L2 已用或≥3；L4 需 L3 已用或≥4。
- 预算用尽 429 + softLanding.options（只做 L0 / 看定义卡 / 换同知识点更小题 / 转教师）。
- 小白解释三件套，≤2 次。
- 真实模型（v2 未接线）：设计上可存在 DEEPSEEK_API_KEY 时调用 https://api.deepseek.com/chat/completions（model deepseek-chat，timeout 8s），输出仍先过 guard；**当前实现仍为 mock，`DEEPSEEK_API_KEY` 只改 health.mode 显示**，以 docs/API.md §8.3 为准。README 写清默认 mock。

---

## 7. 前端要求（public/）

1. 学生端：S0 登录 → S1 首页 → S2 选题 → S3 作答（阶段条、计时、题面、草稿、AI 三段式、提示阶梯、拒绝、小白解释）→ S4 覆盖表+五问复盘 → S5 完成（掌握度、规律/自检卡、变式题）；所有按钮真实调用 API。
2. 教师端：KPI、独立性三档堆叠条、卡点 Top5、未完成名单、学生列表、过程摘要抽屉、题库审核队列、导出 CSV。
3. 后端与数据：health 卡、API 端点表、请求日志（fetch 拦截 method/path/status/耗时）、事件流（刷新）、红线拦截统计、重置数据。
4. 说明：架构图、数据流、红线在后端哪层、启动方式、mock/真实模型、已知限制。

技术约束：原生 HTML/CSS/JS 零依赖；hash 路由 + ?demo=1 自动登录；刷新恢复 attempt；非 2xx 用 toast 保留输入；409/429 显示锁定/软着陆；390 不横向溢出；视觉沿用 05-演示原型风格；「填入示例作答」可用后端脚本 sample 或前端常量；AI 对话区永不显示完整证明/最终答案。

前端可直接用 GET /api/attempts/:id 恢复 state.draft/used/unlocked/messages，不要自己推算预算与解锁。

---

## 8. 测试与验收（Lead 会跑）

1. node tests/e2e.mjs：20+ 断言全 PASS，退出码 0；覆盖登录、隐藏答案、提示锁定/预算/拦截、拒绝、小白上限、覆盖表、复盘、变式、教师看板、CSV、事件、重置。
2. start-demo.cmd 启动后浏览器可开；四个 Tab 无报错；学生端 10 节点走通；教师端数字与 seed 一致（72%/10/4.8/38-34-28）。
3. 后端面板能看到 health/routes/请求日志/事件流/拦截统计/reset。
4. 390/1440 截图不溢出；控制台无 JS 报错。
5. 红线：AI 回复检索不到「证毕/证明如下/综上/答案是」；GET /api/problems/:id 不含 keySteps/hints/referenceProof。

---

## 9. 实现顺序提醒

- 后端先 curl/Invoke-RestMethod 跑通再联调前端；前端先用 ?demo=1 走通。
- 测试用 createServer({port:0, dbPath:临时文件})，不污染演示数据。
- 时间用 ISO；ID 用 crypto.randomUUID()。
- referenceProof、keySteps 原文绝不下发学生端；题目详情字段白名单。
- 前端「后端与数据」Tab 是本次后端演示重点：让非技术评审看懂每次点击都真的打到后端，后端做了预算/拦截/记录。

---

## 10. 实现偏差记录（2026-10-31 验收后补）

| # | 契约写法 | 实际实现 | 处理 |
|---|---|---|---|
| 1 | /hint 只收 L1–L4 | 额外接受 L0（免费追问，不计信息型预算） | 前端演示主用 L2；契约视为 L0–L4 |
| 2 | 平均提示轮数 4.8 无口径 | 响应增加 avgHintRoundsBasis，口径=全部作答的 L1–L4 平均（288/60） | README/API.md 已写明 |
| 3 | completionRate 72 | 同时返回 0.72 与 completionRatePercent=72 | 前端用 percent，兼容两种 |
| 4 | 事件名 attempt_start | 种子/运行统一 attempt_start；另有 paste/finish 扩展事件 | API.md 已列全 |
| 5 | e2e 20+ 断言 | v1 实际 107 条；v2 六层新增后 **111 条** | 验收按 111 条 |
| 6 | 演示版 token 只校验存在 | token 内存保存，服务重启失效 | README 已注明；生产需签名/持久化 |

