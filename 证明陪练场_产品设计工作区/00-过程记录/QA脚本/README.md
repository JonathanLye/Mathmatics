# 全栈 Demo QA 脚本

> 2026-10-31 ｜ Lead 自测用，依赖：Node 24（内置 WebSocket）、Chrome、后端跑在 127.0.0.1:8787。

| 脚本 | 用途 | 运行 |
|---|---|---|
| fs-walkthrough.mjs | Chrome CDP 自动走完 S0→S5 十节点，截图到 00-过程记录/QA截图/fs-*.png | node fs-walkthrough.mjs |
| fs-mobile.mjs | CDP 390×844 模拟，截 S1/S2/S3/教师/后端，输出 scrollWidth/越界元素 | node fs-mobile.mjs |

前置：先启动后端（06-前后端Demo 下 node server/server.mjs），再运行脚本。

| v2-walkthrough.mjs | v2 六层：知识点卡→解析→5步→终稿→讲解→变式→总结，截图 v2-*.png | node v2-walkthrough.mjs |
| v2-mobile.mjs | v2 390×844：六层 stepper 换行、提交 sticky、scrollWidth/越界 | node v2-mobile.mjs |
| v2-proactive.mjs | v2 第3层连续失败 2 次触发主动提示 offer，截图 v2-proactive.png | node v2-proactive.mjs |
