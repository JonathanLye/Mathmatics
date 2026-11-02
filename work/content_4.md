:::h1 8|局限与尚未验证的部分
:::h2 8.1|先把局限放回方法论
:::p 猜想地图要求中介过程有可观察证据；在设计层面论证充分、但还没有过程数据时，理论猜想不能被声称成立（Sandoval, 2014, p. 23）。本报告的所有“有效性”判断都还停留在预期层面，第 7 节已作区分。
:::p 本研究产出的是情境化的局部理论，而不是脱离情境的普遍规律（Cobb 等, 2003）。因此下面的局限不是免责声明，而是下一步工作的清单：每一条都对应表 8-1 中的一个验证动作。
:::h2 8.2|技术局限
:::ol
- **归类器仍是规则匹配。** 演示版用正则匹配把学生的一行归到关键步骤，只用于展示交互。正式版要换成大模型的结构化输出，并用约 60 条人工标注的学生步骤验证；“另一种证法被误判”的比例必须为 0。
- **“零泄题”只对教师预写的文本成立。** 一旦允许模型在线改写提示，就只能报告实测泄题率。在一项计算机科学选择题辅导的对抗性测试中，即使加入双代理审查，会话级泄题率仍有 17.8%（Shah 等, 2026）；这说明在线生成只能把泄题压低，不能归零。
- **阈值没有直接文献依据。** 20 秒停留、30 秒内连点 3 次暂停 60 秒、3 分钟判定卡住、每题透露上限 2，都是工程默认值，需要用内测日志校准，并在论文中报告校准过程。
- **公式输入尚未定稿。** 演示版使用 Unicode 符号键位行，正式版换成 MathLive 并按数学分析常用写法定制键位；移动端输入成本对“依据填写率”的影响需要单独监测。
:::h2 8.3|证据局限
:::ol
- **自我解释的结论不一致。** 读证明的自我解释训练有效（Hodds 等, 2014，R），但这些研究针对的是读证明，不能直接外推到写证明。第 4 层因此设为可选、只问 3 题，并把它的效果列为待检验假设，而不是既定结论。
- **“要指导”与“先失败”之间存在张力。** 最低限度指导对新手不利（Kirschner 等, 2006，M），而先尝试后教学在概念与迁移上有效（Sinha & Kapur, 2021，M）；两者的交集是“先尝试，后讲评”，但讲评必须真实发生（D-07）。
- **元分析多来自中小学。** 专长逆转效应的元分析（Tetzlaff 等, 2025）与具体—抽象渐隐的综述（Fyfe 等, 2014）以中小学任务为主，外推到大学证明写作需要谨慎。
- **证据标签是自定的。** 本文的 M/R/E/B 是面向设计决策的实用标签，不是教育设计研究或循证教育的通行分级；每条原则的“依据”都注明了推断跨度与适用边界。
:::h2 8.4|研究局限
:::ol
- **单校、小样本。** 计划为两班、约 30/30 人；交叉设计虽能提高等效样本量，但最小可检测效应仍在 d ≈ 0.51，主效应可能检不出。
- **携带效应与污染。** 先经历 A 的学生可能在第二块保留“先写骨架”的习惯；同班学生交流无法禁止，只能通过问卷与粘贴检测测量，并做敏感性分析。
- **外部 AI 无法阻止。** 学生仍可把题目拍给外部 AI；系统只能记录自报使用，并在论文中报告。
- **评分者偏差。** 主要结果由教师按细则评分、20% 双评；需要报告 ICC，并对评分者进行培训与校准。
:::h2 8.5|未验证事项与验证计划
:::table 表 8-1　未验证事项、风险与验证计划 | widths=3.3,3.9,5.2,3.06 | align=l,l,l,l | note=注：时间点为相对安排，具体日期待课题组成立试点工作组后确定。
| 未验证事项 | 风险 | 验证方式 | 时间点 |
| 归类器为规则匹配 | 误判导致指标失真 | 60 条人工标注步骤；另一证法误判率 = 0 | 正式版开发前 |
| 在线改写后的泄题率 | 红线失效 | 40 条红队用例；报告实测泄题率，不承诺零 | 内测阶段 |
| 20 秒、3 分钟、≤2 等阈值 | 门槛过松或过严 | 内测日志分布校准 | 内测第 1 周 |
| 第 4 层自我解释的效果 | 无效或增加负担 | 作为待检验假设；比较启用与未启用的班级 | 试点 |
| 移动端输入成本 | 依据填写率下降 | 设备类型作为协变量；记录单行输入耗时 | 内测与试点 |
| 外部 AI 使用 | 污染处理效应 | 每周自报问卷；一次性长文本粘贴检测；敏感性分析 | 试点全程 |
| 样本量与统计功效 | 主效应检不出 | 预注册组合证据；必要时扩大样本或延长试点 | 试点前 |
| 单校外部效度 | 结论不可外推 | 报告情境与边界；不做普遍性宣称 | 论文写作 |

:::h1 9|需要罗老师确认的事项
:::p 以下 7 项决策是对设计要求与实施推广条件的细化确认。其中 D-08 决定实验能否回答归因问题，D-10 决定研究能否从“预期有效性”推进到“实际有效性”（McKenney & Reeves, 2019, ch. 7）。其余 4 项由项目组或甲方确认，列在附录 C，供完整追溯。
:::table 表 9-1　需要罗老师确认的 7 项决策 | widths=1.2,3.3,4.3,3.4,3.26 | align=c,l,l,l,l | note=注：完整 11 项决策清单见附录 C；“若不同意的后果”一列帮助判断优先级，不表示项目无法继续。
| 编号 | 事项 | 我们的默认 | 需要您定的原因 | 若不同意的后果 |
| D-01 | 提示 H0–H4 的分级，以及“点名定理”算不算透露 | 点名定义不算；点名决定性定理（如本题的判别法）算 0.5 | 这直接决定“多少提示仍算独立完成” | 独立度指标需重新定义，历史数据不可比 |
| D-02 | 每题透露上限 | 2 个关键步骤 | 与技术方案一致；影响独立度的分母 | 上限提高会削弱“不泄题”的强度，需重新论证 |
| D-03 | 第 4 层自检是否启用 | 启用，可选，3 题 | 文献结论不一致，需按班级情况判断 | 关闭后第 6 层总结的支撑变弱，需另设检查 |
| D-07 | 题目关闭后是否由您发布参考证明与讲评 | 建议发布，A、B 两组同样发布 | 先尝试后讲评的效果依赖讲评；属教学安排，不违反红线 | 条件 B 失去“看参考证明”的对照意义，须改对照 |
| D-08 | 实验设计 | 同平台主动对照 + 交叉，班内个体随机 | 需要您接受同一班内学生体验不同条件 | 退回按班分组，只有 2 个群，无法分离班级效应 |
| D-09 | 成功标准 | 预注册的主效应方向一致 + 过程指标达到阈值 | 需求书“多 8 个百分点”约合 d = 0.32–0.53，30/30 规模下功效仅 0.24–0.54 | 按原标准检验，很可能得到“不显著”的结论 |
| D-10 | 伦理审查 | 本校科技伦理（审查）委员会 | 《科技伦理审查办法（试行）》第二条要求以人为研究参与者的活动须经审查 | 无法合规开展试点，数据不能用于发表 |
:::h2 9.1|四项需要特别讨论的默认值
:::p **D-01（点名定理算多少透露）。** 默认把“点名定义”放在 H1、不计透露量，把“点名决定性定理”放在 H2、计 0.5。理由是：定义与证明框架属于形式部分，可以大方地教（DP2）；而“选哪个判别法”正是本题的解题核心，提前点名等于替学生完成最难的一步。若您认为在您的课堂上点名定理属于正常的教学提示，可以下调到 0；但需要同步修改独立度的定义与论文中的表述。
:::p **D-02（每题透露上限 2）。** 这个数字来自技术方案，也与原型演示一致。它的作用是让“独立完成”有可计算的边界：透露 2 个关键步骤之后，学生仍须自己写出其余步骤。若提高上限，建议同时提高“关键步骤”的登记粒度，否则独立度会被高估。
:::p **D-07（题后讲评）。** 建议在题目关闭后由您发布参考证明与讲评，A、B 两组同样发布。理由是：先尝试后教学的正效应以“基于学生作品的讲评”为条件（Sinha & Kapur, 2021）；如果尝试之后没有讲评，学生可能把错误做法固化。这不违反红线，因为红线约束的是 AI 在解题过程中的输出。
:::p **D-09（成功标准）。** 建议改为“预注册的主效应方向一致 + 过程指标达到阈值”，而不是承诺“多 8 个百分点”。这不是降低标准，而是把不可控的分数差换成可预注册、可解释的组合证据；具体功效数字见 7.3 节。
:::h2 9.2|其余事项
:::p D-04（迁移题是否计入干预剂量）、D-05（公式键盘）、D-06（拍照上传）、D-11（产品形态）由项目组或甲方确认，不影响本次教学评审的结论。完整清单与默认值见附录 C。

:::h1 10|主要参考文献
:::p 参考文献采用 APA 第 7 版著者—出版年制，与正文中的“（作者, 年份）”引注一一对应。全部条目的题名、作者、卷期页与 DOI 已于 2026 年 11 月 2 日通过 Crossref、出版社页面或原文 PDF 逐条核对；核对记录见工作区 `research_notes/设计原理规范化/notes/refs.md`。
:::refs
- Alcock, L., & Inglis, M. (2008). Doctoral students' use of examples in evaluating and proving conjectures. *Educational Studies in Mathematics, 69*(2), 111–129. https://doi.org/10.1007/s10649-008-9149-x
- Aleven, V., Roll, I., McLaren, B. M., & Koedinger, K. R. (2016). Help helps, but only so much: Research on help seeking with intelligent tutoring systems. *International Journal of Artificial Intelligence in Education, 26*(1), 205–223. https://doi.org/10.1007/s40593-015-0089-1
- Bakker, A. (2018). *Design research in education: A practical guide for early career researchers*. Routledge. https://doi.org/10.4324/9780203701010
- Bastani, H., Bastani, O., Sungu, A., Ge, H., Kabakcı, Ö., & Mariman, R. (2025). Generative AI without guardrails can harm learning: Evidence from high school mathematics. *Proceedings of the National Academy of Sciences, 122*(26), Article e2422633122. https://doi.org/10.1073/pnas.2422633122
- Cobb, P., Confrey, J., diSessa, A., Lehrer, R., & Schauble, L. (2003). Design experiments in educational research. *Educational Researcher, 32*(1), 9–13. https://doi.org/10.3102/0013189X032001009
- Design-Based Research Collective. (2003). Design-based research: An emerging paradigm for educational inquiry. *Educational Researcher, 32*(1), 5–8. https://doi.org/10.3102/0013189X032001005
- Edelson, D. C. (2002). Design research: What we learn when we engage in design. *Journal of the Learning Sciences, 11*(1), 105–121. https://doi.org/10.1207/S15327809JLS1101_4
- Fyfe, E. R., McNeil, N. M., Son, J. Y., & Goldstone, R. L. (2014). Concreteness fading in mathematics and science instruction: A systematic review. *Educational Psychology Review, 26*(1), 9–25. https://doi.org/10.1007/s10648-014-9249-3
- Gonzalez, S., Amiri Bavandpour, A., Ye, P., Zhang, E., Aleksejevs, R., Antić, T., Baron, P., Bhalerao, S., Bhattacharya, S., Burton, Z., Byrne, J., Choi, H., Disha, N. A., Encz, K. I., Fang, Y., George, R. J., Ghorbani, E., Goldfarb, A., Guo, J., … Liu, Q. C. (2026). QEDBench: Quantifying the alignment gap in automated evaluation of university-level mathematical proofs. In *Proceedings of the 43rd International Conference on Machine Learning* (Proceedings of Machine Learning Research, Vol. 306, pp. 36056–36179). PMLR. https://proceedings.mlr.press/v306/gonzalez26a.html
- Hodds, M., Alcock, L., & Inglis, M. (2014). Self-explanation training improves proof comprehension. *Journal for Research in Mathematics Education, 45*(1), 62–101. https://doi.org/10.5951/jresematheduc.45.1.0062
- Kali, Y. (2006). Collaborative knowledge building using the Design Principles Database. *International Journal of Computer-Supported Collaborative Learning, 1*(2), 187–201. https://doi.org/10.1007/s11412-006-8993-x
- Watson, A., & Mason, J. (2002). Student-generated examples in the learning of mathematics. *Canadian Journal of Science, Mathematics and Technology Education, 2*(2), 237–249. https://doi.org/10.1080/14926150209556516
- Kalyuga, S., Ayres, P., Chandler, P., & Sweller, J. (2003). The expertise reversal effect. *Educational Psychologist, 38*(1), 23–31. https://doi.org/10.1207/S15326985EP3801_4
- Kestin, G., Miller, K., Klales, A., Milbourne, T., & Ponti, G. (2025). AI tutoring outperforms in-class active learning: An RCT introducing a novel research-based design in an authentic educational setting. *Scientific Reports, 15*, Article 17458. https://doi.org/10.1038/s41598-025-97652-6
- Kirschner, P. A., Sweller, J., & Clark, R. E. (2006). Why minimal guidance during instruction does not work: An analysis of the failure of constructivist, discovery, problem-based, experiential, and inquiry-based teaching. *Educational Psychologist, 41*(2), 75–86. https://doi.org/10.1207/s15326985ep4102_1
- Kraft, M. A. (2020). Interpreting effect sizes of education interventions. *Educational Researcher, 49*(4), 241–253. https://doi.org/10.3102/0013189X20912798
- Macina, M., Daheim, N., Chowdhury, S. P., Sinha, T., Kapur, M., Gurevych, I., & Sachan, M. (2023). MathDial: A dialogue tutoring dataset with rich pedagogical properties grounded in math reasoning problems. In *Findings of the Association for Computational Linguistics: EMNLP 2023* (pp. 5602–5621). Association for Computational Linguistics. https://doi.org/10.18653/v1/2023.findings-emnlp.372
- Mahinpei, R., Druchyna, S., & Horta Ribeiro, M. (2026). *When LLMs help—and hurt—teaching assistants in proof-based courses* (arXiv:2602.23635). arXiv. https://doi.org/10.48550/arXiv.2602.23635
- McKenney, S., & Reeves, T. C. (2019). *Conducting educational design research* (2nd ed.). Routledge. https://doi.org/10.4324/9781315105642
- Mejía-Ramos, J. P., Fuller, E., Weber, K., Rhoads, K., & Samkoff, A. (2012). An assessment model for proof comprehension in undergraduate mathematics. *Educational Studies in Mathematics, 79*(1), 3–18. https://doi.org/10.1007/s10649-011-9349-7
- Moore, R. C. (1994). Making the transition to formal proof. *Educational Studies in Mathematics, 27*(3), 249–266. https://doi.org/10.1007/BF01273731
- Nieveen, N. (1999). Prototyping to reach product quality. In J. van den Akker, R. M. Branch, K. Gustafson, N. Nieveen, & T. Plomp (Eds.), *Design approaches and tools in education and training* (pp. 125–135). Kluwer Academic Publishers. https://doi.org/10.1007/978-94-011-4255-7_10
- Nieveen, N., & Folmer, E. (2013). Formative evaluation in educational design research. In T. Plomp & N. Nieveen (Eds.), *Educational design research: Part A. An introduction* (pp. 152–169). SLO.
- OpenAI. (2025, July 29). *Introducing study mode in ChatGPT*. https://openai.com/index/chatgpt-study-mode/
- Plomp, T. (2013). Educational design research: An introduction. In T. Plomp & N. Nieveen (Eds.), *Educational design research: Part A. An introduction* (pp. 10–51). SLO.
- Reeves, T. C. (2006). Design research from a technology perspective. In J. van den Akker, K. Gravemeijer, S. McKenney, & N. Nieveen (Eds.), *Educational design research* (pp. 52–66). Routledge.
- Sandoval, W. (2014). Conjecture mapping: An approach to systematic educational design research. *Journal of the Learning Sciences, 23*(1), 18–36. https://doi.org/10.1080/10508406.2013.778204
- Schulz, A. L., & Voermanek, J. (2025). How do help-seeking and help-abuse affect learning achievement in an interactive learning environment? *Computers and Education Open, 8*, Article 100247. https://doi.org/10.1016/j.caeo.2025.100247
- Selden, A., & Selden, J. (2003). Validations of proofs considered as texts: Can undergraduates tell whether an argument proves a theorem? *Journal for Research in Mathematics Education, 34*(1), 4–36. https://doi.org/10.2307/30034698
- Selden, A., & Selden, J. (2013). Proof and problem solving at university level. *The Mathematics Enthusiast, 10*(1–2), 303–334. https://doi.org/10.54870/1551-3440.1269
- Shah, S. T., Mohamed, M., & Mohamed, A. (2026). Benchmarking and mitigating answer leakage in LLM tutoring under persistent student pressure. In *Proceedings of the 28th Western Canadian Conference on Computing Education* (pp. 1–7). ACM. https://doi.org/10.1145/3828792.3828794
- Shih, B., Koedinger, K. R., & Scheines, R. (2008). A response time model for bottom-out hints as worked examples. In *Proceedings of the 1st International Conference on Educational Data Mining* (pp. 92–101). https://www.educationaldatamining.org/EDM2008/uploads/proc/12_Shih_35.pdf
- Sinha, T., & Kapur, M. (2021). When problem solving followed by instruction works: Evidence for productive failure. *Review of Educational Research, 91*(5), 761–798. https://doi.org/10.3102/00346543211019105
- Srivatsa, K. V. A., Maurya, K. K., & Kochmar, E. (2025). LLMs cannot spot math errors, even when allowed to peek into the solution. In *Proceedings of the 2025 Conference on Empirical Methods in Natural Language Processing* (pp. 10914–10928). Association for Computational Linguistics. https://doi.org/10.18653/v1/2025.emnlp-main.553
- Tall, D., & Vinner, S. (1981). Concept image and concept definition in mathematics with particular reference to limits and continuity. *Educational Studies in Mathematics, 12*(2), 151–169. https://doi.org/10.1007/BF00305619
- Tetzlaff, L., Simonsmeier, B., Peters, T., & Brod, G. (2025). A cornerstone of adaptivity – A meta-analysis of the expertise reversal effect. *Learning and Instruction, 98*, Article 102142. https://doi.org/10.1016/j.learninstruc.2025.102142
- van den Akker, J. (1999). Principles and methods of development research. In J. van den Akker, R. M. Branch, K. Gustafson, N. Nieveen, & T. Plomp (Eds.), *Design approaches and tools in education and training* (pp. 1–14). Kluwer Academic Publishers.
- Weber, K. (2001). Student difficulty in constructing proofs: The need for strategic knowledge. *Educational Studies in Mathematics, 48*(1), 101–119. https://doi.org/10.1023/A:1015535614355
- 潘少颖. (2024, December 11). 辅导作业压力大？豆包爱学能“神助攻”吗？ *IT时报*. https://www.sohu.com/a/835445277_110683
- 科学技术部. (2023). 《科技伦理审查办法（试行）》（国科发监〔2023〕167 号）. https://www.most.gov.cn/

:::h1 附录 A|术语表
:::p 下表只收录本文反复使用、且在中文学术语境中可能产生歧义的术语。首次出现时已在正文中给出英文或定义，此处集中列出，便于评审对照。
:::table 表 A-1　术语表 | widths=3.2,4.2,8.06 | align=l,l,l | note=注：“设计主张”与“设计命题”在中文里均不构成稳定术语，本文统一用“设计主张（design propositions）”。
| 术语 | 英文 | 定义与说明 |
| 设计原理 | design rationale | 对“为什么这样设计”的整体说明，包含问题、约束、原则、机制与证据；本文档即一份设计原理说明 |
| 设计原则 | design principles | 可迁移的启发式陈述，说明在何种情境下为实现何种目的宜采取何种特征；本文第 3 节的 6 条 |
| 设计要求 | design requirements | 设计必须满足的判据，来自情境分析识别的边界条件、机会与约束；本文表 2-1 |
| 设计主张 | design propositions | 关于“可以怎么做、为什么”的方案性主张（McKenney & Reeves 用语）；本文用它解释 R2、R3、R6 的选择性质 |
| 猜想地图 | conjecture map | 把高层猜想、体现设计、中介过程与结果连成两条因果链的图示方法（Sandoval, 2014） |
| 设计猜想 | design conjecture | “如果学习者以这些工具、通过这种话语实践参与这种活动结构，那么这种中介过程会出现” |
| 理论猜想 | theoretical conjecture | “如果这种中介过程发生，就会导致这种结果” |
| 中介过程 | mediating process | 设计要素引发、位于设计与结果之间的活动与互动；本文用日志指标作操作性证据 |
| 设计要素 | design elements | 工具与材料、任务结构、参与结构、话语实践四类 |
| 可观察证据（指标） | observable evidence (indicators) | 本文的操作性用语；Sandoval 原文用 observable interactions 与 artifacts as proxies |
| 独立度 | independence | 1 − 加权透露量 / 关键步骤数；衡量学生独立完成的比例 |
| 透露量 | hint disclosure weight | 一次提示透露的关键步骤量：H2 计 0.5，H3、H4 计 1 |
| 关键步骤 | key step | 由教师在题目包中登记的、构成证明核心的步骤；允许多条路线 |
| 闸门 | gate | 检查外发文本是否包含学生尚未写出的关键步骤的规则模块；失败时默认不发送 |
| 归类器 | classifier | 把学生的一行归到教师登记的关键步骤或常见错误；本文只允许它输出结构化结果 |
| 题目包 | problem package | 每题一份的教师审核材料：题面、定义卡、骨架、关键步骤图、H0–H4、常见错误、自检题等 |
| 六层任务结构 | six-layer task structure | 定义核验、证明骨架、构造与推导、自检、迁移题、总结 |
| H0–H4 | hint levels 0–4 | 追问、定义/框架、方向、局部一步、示范一行；从 H2 起计透露量 |

:::h1 附录 B|复现说明
:::p 本节说明如何从原型重新生成第 5 节的全部画面，以及如何复跑原型的自动自检。命令在项目工作区根目录执行；Playwright 与 Chromium 的路径以本地环境为准。
:::p **截图生成。** 脚本按固定输入依次操作六个画面，输出 JPG 到指定目录：
:::code node 08-重构原型/tests/capture.mjs <playwright-core 目录> <chromium 可执行文件> 09-设计原理说明书/img
:::p **原型自检。** 脚本覆盖归类器、提示门槛与预算、H4 后自我解释、权威施压、预写文本静态穷举与 390 像素宽布局，共 24 项：
:::code node 08-重构原型/tests/proto-test.mjs <playwright-core 目录> <chromium 可执行文件>
:::p **环境与已知限制。** 原型为单文件网页，公式渲染依赖 KaTeX 与字体网络资源；断网时公式显示为源码，交互功能不受影响。截图使用浅色配色、1280 × 860 视口（设备像素比 1.5）；手机画面使用 390 × 844 视口（设备像素比 2）。若原型更新，需重新运行上述两个脚本，并同步更新第 5 节的画面与自检结果。
:::p **文档生成。** 本报告由脚本生成 DOCX，再经 LibreOffice 渲染为 PDF 供校对；正文使用的字体映射与版式参数保存在工作区 `work/` 目录下，便于下次重排时复用。

:::h1 附录 C|完整决策清单
:::p 下表列出全部 11 项决策，供项目组与课题组分工确认。正文第 9 节只展开需要罗老师确认的 7 项；其余 4 项不影响本次教学评审。
:::table 表 C-1　完整决策清单（11 项） | widths=1.2,4.6,5.4,4.26 | align=c,l,l,l | note=注：确认方一列按当前分工填写；如课题组内部另有分工，以实际为准。
| 编号 | 事项 | 默认 | 确认方 |
| D-01 | 提示 H0–H4 的分级与透露量 | 按 3.5 节 | 罗老师 |
| D-02 | 每题透露上限 | 2 个关键步骤 | 罗老师 |
| D-03 | 第 4 层是否启用 | 启用、可选、3 题 | 罗老师 |
| D-04 | 第 5 层迁移题是否计入干预剂量 | 不计，作为协变量 | 罗老师 |
| D-05 | 公式键盘 | 做（MathLive） | 甲方 |
| D-06 | 拍照上传 | 首版不做；内测单独评估 | 甲方 |
| D-07 | 题目关闭后是否发布参考证明与讲评 | 建议发布，A、B 两组同样发布 | 罗老师 |
| D-08 | 对照设计 | 同平台主动对照 + 交叉，班内个体随机 | 罗老师 |
| D-09 | 成功标准 | 预注册主效应 + 过程指标阈值 | 罗老师、项目组 |
| D-10 | 伦理审查主体 | 本校科技伦理（审查）委员会 | 学校 |
| D-11 | 产品形态 | 先 PWA 做研究，小程序二期 | 甲方 |
:::p 以上为全部 11 项决策。本文档的后续修订以第 9 节的确认结果为准；确认后，设计原则、猜想地图与评估方案进入下一轮迭代。
