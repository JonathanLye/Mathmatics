# 参考文献核验记录（refs.md）

- **项目**：证明陪练场原型 v3 ·《设计原理说明（Design Rationale）》
- **核验对象**：`证明陪练场_产品设计工作区/09-设计原理说明书/index.html`
  - 第 10 节「主要参考文献」全部 12 条；
  - 正文「依据」表引用、但**未列入**第 10 节文献表的 5 条（Schulz、Shih、Mahinpei、Kirschner、Fyfe）；
  - 正文中出现具体数字的结论（48%、17%、d = +0.51/−0.43、17.8% 泄题率、效应量、七维框架等）。
- **核验日期**：2026-11-02
- **核验方法**：Crossref REST API 逐条取 DOI 元数据（标题、作者全名、卷、期、页码、文章号、出版年）；出版社正文页交叉核对（PNAS、Nature/Scientific Reports、Springer、ScienceDirect、Taylor & Francis、Routledge、ACL Anthology、PMLR、arXiv）；Mejía-Ramos 等（2012）下载原文 PDF 逐字核对七维名称；Nieveen（1999）取出版社章节摘要核对「三项/四项标准」。
- **状态口径**：`已核实` = 元数据与原文一致（可含补全）；`元数据有误已更正` = 原条目存在缺项或错项，已给出更正；`未找到可靠来源` = 未能在可靠来源中定位。
- **核验结论（一句话）**：18 条核验对象全部找到真实来源，**没有一条是伪造文献**；但第 10 节 12 条主文献中，只有 Sandoval（2014）的题名、刊名、年、卷、期、DOI 全部无误（仅缺页码），其余 11 条均需补全或更正；另有 2 处**实质性口径问题**（Nieveen 1999 的「四项标准」、Shih 2010 的出处年份）、1 处**数字表述风险**（17.8% 泄题率的适用语境），以及 **5 条正文引用未列入文献表**的缺项。

---

## A. 核验表

### A1. 第 10 节「主要参考文献」12 条

> 说明：「原条目」列照抄文档现状；「正确元数据」列已按原刊核对；页码/文章号以出版社页面为准。

| # | 原条目 | 状态 | 正确元数据 | DOI / URL | 关键原文摘录（英文原文 + 中文要点） | 可用于哪一节 |
|---|---|---|---|---|---|---|
| 1 | Bastani H. 等. Generative AI without guardrails can harm learning. PNAS, 2025, 122(26). doi:10.1073/pnas.2422633122 | **元数据有误已更正**（题名缺副标题；缺文章号；作者 6 人） | Bastani, H., Bastani, O., Sungu, A., Ge, H., Kabakcı, Ö., & Mariman, R. (2025). Generative AI without guardrails can harm learning: Evidence from high school mathematics. *Proceedings of the National Academy of Sciences, 122*(26), Article e2422633122. | https://doi.org/10.1073/pnas.2422633122 | "our results show that having GPT-4 access while solving problems significantly improves performance (48% improvement in grades for GPT Base and 127% for GPT Tutor). However, we additionally find that when access is subsequently taken away, students actually perform worse than those who never had access (17% reduction in grades for GPT Base)." 中文要点：练习阶段 GPT Base 相对对照组提高 **48%**（GPT Tutor 为 127%）；撤除 AI 后的考试阶段 GPT Base 相对对照组下降 **17%**；GPT Tutor 的负效应基本消除（点估计 −0.004，与对照组统计上无差异），但**也没有正效应**。样本：土耳其一所大型高中，9–11 年级约 50 个班、**接近 1000 名学生**，4 次 90 分钟实验。 | §1 问题陈述（红线=不给答案的因果依据）；§3 设计原则（护栏=只给提示、提示内置教师解答与常见错误） |
| 2 | Kestin G. 等. AI tutoring outperforms in-class active learning. Scientific Reports, 2025, 15. doi:10.1038/s41598-025-97652-6 | **元数据有误已更正**（题名只有前半句；缺文章号；作者 5 人） | Kestin, G., Miller, K., Klales, A., Milbourne, T., & Ponti, G. (2025). AI tutoring outperforms in-class active learning: An RCT introducing a novel research-based design in an authentic educational setting. *Scientific Reports, 15*, Article 17458. | https://doi.org/10.1038/s41598-025-97652-6 | "We find that students learn significantly more in less time when using the AI tutor, compared with the in-class active learning." 效应量："While the linear regression suggests an effect size of 0.63, this is an underestimation due to ceiling effect; a quantile regression … provides an effect size in the range of 0.73 to 1.3 standard deviations." 中文要点：哈佛大学物理课，233 人选课、**194 人纳入分析**；中位学习增益是对照组两倍以上（z = −5.6, p < 10⁻⁸）；因天花板效应，OLS 效应量 0.63 偏低，分位数回归估计 **0.73–1.3 SD**；AI 组中位用时 **49 分钟**（课堂 60 分钟）。 | §3 设计原则（提示词无法可靠搭建脚手架，须由平台结构控制）；§7 评估方案（随机对照 + 前后测设计范式） |
| 3 | Selden A., Selden J. Proof and problem solving at university level. The Mathematics Enthusiast, 2013. doi:10.54870/1551-3440.1269 | **元数据有误已更正**（缺卷期页） | Selden, A., & Selden, J. (2013). Proof and problem solving at university level. *The Mathematics Enthusiast, 10*(1–2), 303–334. | https://doi.org/10.54870/1551-3440.1269 | "This paper will be concerned with undergraduate and graduate students' problem solving as they encounter it in attempting to prove theorems…" "We take Schoenfeld's (1985) view of problem, namely, a mathematical task is a problem for an individual if that person does not already know a method of solution for that task." 中文要点：证明构造被当作**问题解决**处理——学生面对证明时缺的是「选哪条路、用哪个定理」的策略，而不只是形式知识。 | §1 问题陈述（证明 ≠ 套公式）；§3 设计原则（提示应指向策略而非结论） |
| 4 | Tall D., Vinner S. Concept image and concept definition in mathematics. Educational Studies in Mathematics, 1981, 12. doi:10.1007/BF00305619 | **元数据有误已更正**（缺期号、页码；题名缺副标题） | Tall, D., & Vinner, S. (1981). Concept image and concept definition in mathematics with particular reference to limits and continuity. *Educational Studies in Mathematics, 12*(2), 151–169. | https://doi.org/10.1007/BF00305619 | "the verbal definition of a limit 'sₙ→s' which says 'we can make sₙ as close to s as we please, provided that we take n sufficiently large' induces in many individuals the notion that sₙ cannot be equal to s (see Schwarzenberger and Tall, 1978)." 中文要点：常见的「任意接近」式口头定义会在学生脑中出现**概念意象**（sₙ 不能等于 s），与形式定义冲突，是「潜在冲突因子」。 | §1 问题陈述（学生误读「任意接近」）；§3 设计原则（提问措辞必须精确，避免诱发错误概念意象） |
| 5 | Tetzlaff L. 等. A cornerstone of adaptivity: a meta-analysis of the expertise reversal effect. Learning and Instruction, 2025. doi:10.1016/j.learninstruc.2025.102142 | **元数据有误已更正**（缺卷号、文章号；作者全名与四作者顺序需补） | Tetzlaff, L., Simonsmeier, B., Peters, T., & Brod, G. (2025). A cornerstone of adaptivity – A meta-analysis of the expertise reversal effect. *Learning and Instruction, 98*, Article 102142. | https://doi.org/10.1016/j.learninstruc.2025.102142 | "Low prior knowledge learners learn better from high-assistance instruction (d = 0.505). High prior knowledge learners learn better from low-assistance instruction (d = −0.428)." 另："the expertise reversal effect is not symmetrical: providing novices with assistance has a stronger effect than withholding assistance from experts." 中文要点：元分析纳入 **60 项实验、176 个效应量、5924 名被试**；低先备 → 高辅助 **d = 0.505**，高先备 → 低辅助 **d = −0.428**；且效应**不对称**（给新手辅助的收益大于撤走专家辅助的收益）。 | §3 设计原则（H0–H4 提示分级与自适应）；§7 评估方案（按先备知识分层分析） |
| 6 | Aleven V. 等. Help helps, but only so much. IJAIED, 2016. | **元数据有误已更正**（题名截断；缺卷、期、页、DOI） | Aleven, V., Roll, I., McLaren, B. M., & Koedinger, K. R. (2016). Help helps, but only so much: Research on help seeking with intelligent tutoring systems. *International Journal of Artificial Intelligence in Education, 26*(1), 205–223. | https://doi.org/10.1007/s40593-015-0089-1 | "feedback on help seeking helped students to use on-demand help more deliberately, even after the feedback was no longer given, but not to achieve better learning outcomes." 另："An empirical finding that is still largely intact today is that Help Abuse … tends to be frequent." / "presented in our IJAIED 2006 shows this behavior to be both frequent and negatively correlated with learning"。中文要点：帮助行为可以被干预改善，但**改善求助行为 ≠ 提升学习成绩**；「帮助滥用」（help abuse）既普遍又与学习负相关。 | §3 设计原则（不能只「提供帮助」，必须设计求助行为）；§8 局限（平台尚未验证求助行为改变） |
| 7 | Gonzalez S. 等. QEDBench. ICML 2026, PMLR v306. arXiv:2602.20629 | **已核实**（文献真实存在；题名需补全，补 PMLR 页码） | Gonzalez, S., Amiri Bavandpour, A., Ye, P., Zhang, E., Aleksejevs, R., Antić, T., Baron, P., Bhalerao, S., Bhattacharya, S., Burton, Z., Byrne, J., Choi, H., Disha, N. A., Encz, K. I., Fang, Y., George, R. J., Ghorbani, E., Goldfarb, A., Guo, J., … Liu, Q. C. (2026). QEDBench: Quantifying the alignment gap in automated evaluation of university-level mathematical proofs. In *Proceedings of the 43rd International Conference on Machine Learning* (Proceedings of Machine Learning Research, Vol. 306, pp. 36056–36179). PMLR. | https://proceedings.mlr.press/v306/gonzalez26a.html ；arXiv: https://arxiv.org/abs/2602.20629 | PMLR 摘要："we reveal that certain frontier evaluators like Claude 4.5 Opus exhibit significant positive bias (up to +0.28 mean score inflation), effectively 'hallucinating rigor' in flawed proofs." 中文要点：**272 道**高年级本科/早期研究生水平证明题、**1300+ 份**由 5 个前沿模型生成的解答、**7 评委 × 5 解答**双评分矩阵、**1000+ 小时**博士级人工评分；LLM 评委相对人工存在系统性**正偏差（偏宽）**。 | §7 评估方案（LLM 评审不能作唯一依据；人工双评）；§8 局限 |
| 8 | Srivatsa K. V. A. 等. LLMs cannot spot math errors, even when allowed to peek into the solution. EMNLP 2025. doi:10.18653/v1/2025.emnlp-main.553 | **已核实**（补页码；注意 Crossref 页码与 ACL 官方不一致，以 ACL 为准） | Srivatsa, K. V. A., Maurya, K. K., & Kochmar, E. (2025). LLMs cannot spot math errors, even when allowed to peek into the solution. In *Proceedings of the 2025 Conference on Empirical Methods in Natural Language Processing* (pp. 10914–10928). Association for Computational Linguistics. | https://doi.org/10.18653/v1/2025.emnlp-main.553 | "Our experiments show that state-of-the-art LLMs struggle to locate the first error step in student solutions even when given access to the reference solution." 中文要点：即使把参考答案给模型，SOTA 模型（Llama3.1-405B、GPT-4o 等）仍难以**定位学生解答的第一处错误**；「会做题」不等于「会判错」。 | §7 评估方案（AI 判错不可靠，评估以人工为准）；§3（AI 只提问、不判对错的分工） |
| 9 | Mejía-Ramos J. P. 等. An assessment model for proof comprehension in undergraduate mathematics. ESM, 2012, 79. doi:10.1007/s10649-011-9349-7 | **已核实**（补期号与页码；七维名称见右栏） | Mejía-Ramos, J. P., Fuller, E., Weber, K., Rhoads, K., & Samkoff, A. (2012). An assessment model for proof comprehension in undergraduate mathematics. *Educational Studies in Mathematics, 79*(1), 3–18. | https://doi.org/10.1007/s10649-011-9349-7 | "Our model describes ways to assess students' understanding of seven different aspects of a proof." 七个维度原文名称（局部 3 项 + 整体 4 项）：**局部** 1. Meaning of terms and statements；2. Logical status of statements and proof framework；3. Justification of claims；**整体** 4. Summarizing via high-level ideas；5. Identifying the modular structure；6. Transferring the general ideas or methods to another context；7. Illustrating with examples。 | §7 评估方案（证明理解测验的七维框架） |
| 10 | Sandoval W. Conjecture mapping: an approach to systematic educational design research. Journal of the Learning Sciences, 2014, 23(1). doi:10.1080/10508406.2013.778204 | **已核实**（页码 18–36 正确；建议补页码） | Sandoval, W. (2014). Conjecture mapping: An approach to systematic educational design research. *Journal of the Learning Sciences, 23*(1), 18–36. | https://doi.org/10.1080/10508406.2013.778204 | "The ideas a research team has about how embodied elements of the design generate mediating processes can be articulated as design conjectures. The ideas a team has about how those processes produce desired outcomes are theoretical conjectures." 中文要点：猜想地图把「设计要素 → 中介过程 → 期望结果」拆成**设计猜想**与**理论猜想**两段，都可检验。 | §4 猜想地图（唯一直接对应文献） |
| 11 | McKenney S., Reeves T. C. Conducting Educational Design Research (2nd ed.). Routledge, 2019. | **已核实**（版次/年份/出版社正确；建议补 DOI） | McKenney, S., & Reeves, T. C. (2019). *Conducting educational design research* (2nd ed.). Routledge. | https://doi.org/10.4324/9781315105642 | 专著（无摘要引文）。出版社简介："Educational design research blends scientific investigation with systematic development and implementation of solutions to educational problems." 中文要点：教育设计研究的「分析—设计—评价—反思」迭代循环。出版细节：第 2 版 326 页，印刷版权年 **2019**，电子版 2018 年 9 月上线——APA 用 2019 即可。 | §7 评估方案（EDR 方法论）；§2 设计要求 |
| 12 | Nieveen N. Prototyping to reach product quality. In van den Akker et al. (Eds.), Design Approaches and Tools in Education and Training. Kluwer, 1999. | **元数据有误已更正**（缺页码与编者全名；**「四项标准」与原文不符**，见 C-4） | Nieveen, N. (1999). Prototyping to reach product quality. In J. van den Akker, R. M. Branch, K. Gustafson, N. Nieveen, & T. Plomp (Eds.), *Design approaches and tools in education and training* (pp. 125–135). Kluwer Academic Publishers. | https://doi.org/10.1007/978-94-011-4255-7_10 | 章节摘要："This chapter provides a framework for product quality consisting of the following **three** criteria: validity, practicality and effectiveness…" 中文要点：Nieveen（1999）提出的是**三项**质量标准——有效性（validity：内容效度 + 建构效度）、实用性（practicality）、效果（effectiveness）。出版社：Kluwer Academic Publishers（Dordrecht，ISBN 0-7923-6139-3），现由 Springer 托管。 | §7 评估方案（原型质量与形成性评价） |

### A2. 正文引用、但未列入第 10 节文献表的 5 条 + 17.8% 数字的来源（共 6 条）

| # | 原条目 | 状态 | 正确元数据 | DOI / URL | 关键原文摘录（英文原文 + 中文要点） | 可用于哪一节 |
|---|---|---|---|---|---|---|
| 13 | Schulz 2025（正文：「分步提示有害、策略提示无害」） | **已核实**（原条目只有「Schulz 2025」，无出处；已定位） | Schulz, A. L., & Voermanek, J. (2025). How do help-seeking and help-abuse affect learning achievement in an interactive learning environment? *Computers and Education Open, 8*, Article 100247. | https://doi.org/10.1016/j.caeo.2025.100247 | "The results showed that increased help-seeking had a significant negative impact on learning achievement. However, this could only be observed for the use of step-by-step hints, but not for the use of strategic help." 中文要点：**322 名师范生**、数字转换（number conversion）任务；只有「分步提示」（step-by-step hints）的使用与学习成绩**负相关**，「策略提示」（strategic help）没有这种负效应；自报的 help abuse 部分中介该负效应。 | §3 设计原则（H 级提示：少给分步答案式提示，多给策略性提问） |
| 14 | Shih 等 2010（正文：「在兜底提示上停留思考与学习相关」） | **元数据有误已更正**（出处年份/载体需改：原始出处是 EDM 2008 会议论文；2010 年是 CRC 手册章节重印） | 原始出处：Shih, B., Koedinger, K. R., & Scheines, R. (2008). A response time model for bottom-out hints as worked examples. In *Proceedings of the 1st International Conference on Educational Data Mining (EDM 2008)*. 重印章节：Shih, B., Koedinger, K. R., & Scheines, R. (2010). A response-time model for bottom-out hints as worked examples. In C. Romero, S. Ventura, M. Pechenizkiy, & R. S. J. d. Baker (Eds.), *Handbook of educational data mining* (pp. 201–211). CRC Press. | 章节 DOI：https://doi.org/10.1201/b10274-17 ；EDM 2008 全文 PDF：https://www.educationaldatamining.org/EDM2008/uploads/proc/12_Shih_35.pdf | "we focus only on bottom-out hints… spending time thinking about bottom-out hints is beneficial to learning." "HINTs, our main indicator, has a correlation of about 0.5 with both the post-test and the learning gain." 中文要点：**39 名**学生、几何智能导师系统；在「兜底提示」（bottom-out hint，等于给出解法步骤）上停留思考的时间与前后测学习增益相关约 **r ≈ 0.5**，作者解释为自发自我解释（self-explanation）。注意：这是**相关证据**，不是因果。 | §3 设计原则（H4 兜底提示后应留出思考时间，不宜立即给下一步）；§7 过程指标（提示停留时长） |
| 15 | Mahinpei 等 2026（正文：「LLM 偏离参考解即扣分」） | **已核实**（补全作者与编号） | Mahinpei, R., Druchyna, S., & Horta Ribeiro, M. (2026). *When LLMs help—and hurt—teaching assistants in proof-based courses* (arXiv:2602.23635). arXiv. | https://arxiv.org/abs/2602.23635 ；https://doi.org/10.48550/arXiv.2602.23635 | "the LLM sometimes directly compares the student's submission to the provided instructor's solution and assigns lower rubric items if the student's approach differs significantly [O1D: LLM's Sensitivity to Solution Strategy]." 另："penalizes deviations from the instructor's reference solution"。中文要点：单个本科证明课程的 case study / technology probe（o3-mini）：LLM 评分对**偏离教师参考解的解法更严格**，即使学生的做法在课程惯例内成立。 | §7 评估方案（评分细则必须允许等价解法；LLM 只做辅助）；§8 局限 |
| 16 | Kirschner P. A., Sweller J., Clark R. E. 2006. Why minimal guidance during instruction does not work. Educational Psychologist, 41(2). | **已核实**（补页码与 DOI；题名可保留缩写，正式引用建议补全副标题） | Kirschner, P. A., Sweller, J., & Clark, R. E. (2006). Why minimal guidance during instruction does not work: An analysis of the failure of constructivist, discovery, problem-based, experiential, and inquiry-based teaching. *Educational Psychologist, 41*(2), 75–86. | https://doi.org/10.1207/s15326985ep4102_1 | "evidence from empirical studies over the past half-century that consistently indicate that minimally guided instruction is less effective and less efficient than instructional approaches that place a strong emphasis on guidance of the student learning process. The advantage of guidance begins to recede only when learners have sufficiently high prior knowledge to provide 'internal' guidance." 中文要点：**完全不指导/最低限度指导**对新手效果更差；只有先备知识足够高时，指导优势才减弱（正好接 Tetzlaff 的 expertise reversal）。 | §3 设计原则（为什么必须由平台提供结构，而不是放任探索）；§1 |
| 17 | Fyfe E. R. 等 2014. Concreteness fading. Educational Psychology Review. | **已核实**（补卷期页与 DOI） | Fyfe, E. R., McNeil, N. M., Son, J. Y., & Goldstone, R. L. (2014). Concreteness fading in mathematics and science instruction: A systematic review. *Educational Psychology Review, 26*(1), 9–25. | https://doi.org/10.1007/s10648-014-9249-3 | "we recommend beginning with concrete materials and then explicitly and gradually fading to the more abstract." 四项机制："(1) helping learners interpret ambiguous or opaque abstract symbols…, (2) providing embodied perceptual and physical experiences…, (3) enabling learners to build up a store of memorable images…, (4) guiding learners to strip away extraneous concrete properties and distill the generic, generalizable properties." 中文要点：先具体、再**显式且逐步**渐隐到抽象，优于「只具体」或「只抽象」。 | §3 设计原则（例证→符号的渐隐路径；H 级提示的淡出节奏） |
| 18 | 正文 §8：「文献中双代理审查后仍有 17.8%」（无文献名，仅给数字） | **已核实**（新增定位；数字准确，语境需限定） | Shah, S. T., Mohamed, M., & Mohamed, A. (2026). Benchmarking and mitigating answer leakage in LLM tutoring under persistent student pressure. In *Proceedings of the 28th Western Canadian Conference on Computing Education* (pp. 1–7). ACM. | https://doi.org/10.1145/3828792.3828794 | "Dual-agent supervision reduced conversation-level leakage from 27.0% to 17.8% (9.2 percentage points, 34% relative)." 中文要点：计算机科学选择题辅导（150 题、900 段对话、最多 6 轮对抗性施压、GPT-5.1 与 Gemini-3-Flash-Preview）；单代理泄题 27.0%，双代理审查后仍 **17.8%**；监督者拒稿 6.40%，其中 94.2% 的拒稿事件成功拦截泄题内容。 | §7 评估方案（泄题率作为必须实测的指标）；§8 局限（「0 泄题」只对预写文本成立） |

### A3. 正文数字溯源与逐项核对

| 数字/说法 | 文档写法 | 原文出处与原文表述 | 核对结论 | 建议写法 |
|---|---|---|---|---|
| 48% | 「无护栏的 GPT-4 使练习成绩提高 48%」 | Bastani et al. 2025：practice 阶段 GPT Base 相对对照组 **+48%**（GPT Tutor +127%） | **数字正确**，但 48% 与 127% 分属两个实验组，不能混写；且 48%/127% 都是**相对提高**（对照组练习均分 0.28，绝对差 0.137） | 「练习阶段，无护栏组（GPT Base）的练习成绩比对照组高 48%，护栏组（GPT Tutor）高 127%」 |
| 17% | 「撤除后考试成绩反而下降 17%」 | 同上：考试阶段 GPT Base 比对照组低 **17%**（绝对差 0.054/1），"statistically significantly worse" | **数字正确**；但需注意「下降 17%」是相对对照组均值，不是 17 个百分点；且 **GPT Tutor 只是消除了负效应，并未带来正效应** | 「撤除 AI 后的独立考试中，无护栏组比对照组低 17%；护栏组与对照组无统计差异（也无提升）」 |
| 约 1000 名高中生 | 「约 1000 名高中生参加的随机实验」 | "nearly a thousand high school math students"；约 50 个 9–11 年级班，4 次 90 分钟 | **正确** | 保留；可补「土耳其一所大型高中」 |
| d = +0.51 / −0.43 | 「低先备学生在高辅助下 d=+0.51，高先备学生 d=−0.43」 | Tetzlaff et al. 2025：**d = 0.505**（低先备/高辅助）、**d = −0.428**（高先备/低辅助） | **四舍五入正确**；若文档要求精确值应写 0.505 / −0.428 | 正式文档建议写 `d = 0.505` 与 `d = −0.428`，或 `d ≈ +0.51 / −0.43`（并注明已四舍五入） |
| 「效应量」Kestin | 文档仅写「AI tutoring outperforms in-class active learning」 | OLS 效应量 **0.63**（作者称被天花板效应低估）；分位数回归 **0.73–1.3 SD**；N = 194（233 人选课） | **未在文档中出现数字，不构成错误**；若补充数字需说明口径 | 「因天花板效应，OLS 估计 0.63 为下限，分位数回归估计为 0.73–1.3 SD」 |
| 17.8% 泄题率 | 「文献中双代理审查后仍有 17.8%」 | Shah, Mohamed & Mohamed (2026)：dual-agent supervision 把会话级泄题率从 **27.0% 降到 17.8%**（9.2 个百分点，相对下降 34%） | **数字正确**；但语境是**计算机科学选择题**辅导、6 轮对抗性对话（150 题、900 段对话、GPT-5.1 / Gemini-3-Flash-Preview），**不是数学证明辅导**，且是单一研究 | 「在一项计算机科学选择题辅导的对抗性测试中，双代理审查把泄题率从 27.0% 降到 17.8%（Shah 等，2026）；这说明即便有审查，泄题也只能被压低而非归零」 |
| 七维框架 | 「按 Mejía-Ramos 七维」 | Mejía-Ramos et al. 2012：**七个** aspects（局部 3 + 整体 4，名称见 A1 第 9 行） | **正确**（确为七维）；但文档未列名称，若列名称必须用上表原文七项，不能与 2010 RUME 版（**六维**）混用 | 给出七维名称，并注明「局部 3 + 整体 4」 |
| QEDBench 编号/出处 | 「ICML 2026, PMLR v306. arXiv:2602.20629」 | PMLR v306, pp. 36056–36179, ICML 2026；arXiv:2602.20629（2026-02-24） | **全部正确**（真实存在） | 补全标题与页码即可 |
| 「0 泄题」 | 「'0 泄题'只对教师预写的文本成立」 | 与 Shah et al. 2026 的实测结果一致（审查后仍有 17.8%） | **表述稳妥**，可保留 | 保留；建议附上具体文献与语境限定 |

---

## B. 可直接粘贴的 APA 7 参考文献列表

> 用法：B1 为英文文献（按第一作者姓氏字母排序，含 17 条核验文献 + 6 条补充文献）；B2 中文文献单列。中文正文引用英文文献时，首次出现给「作者（年份）」，再次出现用「等」。
> 排序依据 APA 7：Alcock < Aleven；Mahinpei < McKenney < Mejía-Ramos；Selden 2003 < Selden 2013。

### B1. 英文文献（APA 7，按第一作者姓氏字母排序）

Alcock, L., & Inglis, M. (2008). Doctoral students' use of examples in evaluating and proving conjectures. *Educational Studies in Mathematics, 69*(2), 111–129. https://doi.org/10.1007/s10649-008-9149-x

Aleven, V., Roll, I., McLaren, B. M., & Koedinger, K. R. (2016). Help helps, but only so much: Research on help seeking with intelligent tutoring systems. *International Journal of Artificial Intelligence in Education, 26*(1), 205–223. https://doi.org/10.1007/s40593-015-0089-1

Bastani, H., Bastani, O., Sungu, A., Ge, H., Kabakcı, Ö., & Mariman, R. (2025). Generative AI without guardrails can harm learning: Evidence from high school mathematics. *Proceedings of the National Academy of Sciences, 122*(26), Article e2422633122. https://doi.org/10.1073/pnas.2422633122

Dawkins, P. C., & Roh, K. H. (2016). Promoting metalinguistic and metamathematical reasoning in proof-oriented mathematics courses: A method and a framework. *International Journal of Research in Undergraduate Mathematics Education, 2*(2), 197–222. https://doi.org/10.1007/s40753-016-0027-0

Fyfe, E. R., McNeil, N. M., Son, J. Y., & Goldstone, R. L. (2014). Concreteness fading in mathematics and science instruction: A systematic review. *Educational Psychology Review, 26*(1), 9–25. https://doi.org/10.1007/s10648-014-9249-3

Gonzalez, S., Amiri Bavandpour, A., Ye, P., Zhang, E., Aleksejevs, R., Antić, T., Baron, P., Bhalerao, S., Bhattacharya, S., Burton, Z., Byrne, J., Choi, H., Disha, N. A., Encz, K. I., Fang, Y., George, R. J., Ghorbani, E., Goldfarb, A., Guo, J., … Liu, Q. C. (2026). QEDBench: Quantifying the alignment gap in automated evaluation of university-level mathematical proofs. In *Proceedings of the 43rd International Conference on Machine Learning* (Proceedings of Machine Learning Research, Vol. 306, pp. 36056–36179). PMLR. https://proceedings.mlr.press/v306/gonzalez26a.html

Kestin, G., Miller, K., Klales, A., Milbourne, T., & Ponti, G. (2025). AI tutoring outperforms in-class active learning: An RCT introducing a novel research-based design in an authentic educational setting. *Scientific Reports, 15*, Article 17458. https://doi.org/10.1038/s41598-025-97652-6

Kirschner, P. A., Sweller, J., & Clark, R. E. (2006). Why minimal guidance during instruction does not work: An analysis of the failure of constructivist, discovery, problem-based, experiential, and inquiry-based teaching. *Educational Psychologist, 41*(2), 75–86. https://doi.org/10.1207/s15326985ep4102_1

Mahinpei, R., Druchyna, S., & Horta Ribeiro, M. (2026). *When LLMs help—and hurt—teaching assistants in proof-based courses* (arXiv:2602.23635). arXiv. https://doi.org/10.48550/arXiv.2602.23635

McKenney, S., & Reeves, T. C. (2019). *Conducting educational design research* (2nd ed.). Routledge. https://doi.org/10.4324/9781315105642

Mejía-Ramos, J. P., Fuller, E., Weber, K., Rhoads, K., & Samkoff, A. (2012). An assessment model for proof comprehension in undergraduate mathematics. *Educational Studies in Mathematics, 79*(1), 3–18. https://doi.org/10.1007/s10649-011-9349-7

Mejía-Ramos, J. P., Lew, K., de la Torre, J., & Weber, K. (2017). Developing and validating proof comprehension tests in undergraduate mathematics. *Research in Mathematics Education, 19*(2), 130–146. https://doi.org/10.1080/14794802.2017.1325776

Moore, R. C. (1994). Making the transition to formal proof. *Educational Studies in Mathematics, 27*(3), 249–266. https://doi.org/10.1007/BF01273731

Nieveen, N. (1999). Prototyping to reach product quality. In J. van den Akker, R. M. Branch, K. Gustafson, N. Nieveen, & T. Plomp (Eds.), *Design approaches and tools in education and training* (pp. 125–135). Kluwer Academic Publishers. https://doi.org/10.1007/978-94-011-4255-7_10

Sandoval, W. (2014). Conjecture mapping: An approach to systematic educational design research. *Journal of the Learning Sciences, 23*(1), 18–36. https://doi.org/10.1080/10508406.2013.778204

Schulz, A. L., & Voermanek, J. (2025). How do help-seeking and help-abuse affect learning achievement in an interactive learning environment? *Computers and Education Open, 8*, Article 100247. https://doi.org/10.1016/j.caeo.2025.100247

Selden, A., & Selden, J. (2003). Validations of proofs considered as texts: Can undergraduates tell whether an argument proves a theorem? *Journal for Research in Mathematics Education, 34*(1), 4–36. https://doi.org/10.2307/30034698

Selden, A., & Selden, J. (2013). Proof and problem solving at university level. *The Mathematics Enthusiast, 10*(1–2), 303–334. https://doi.org/10.54870/1551-3440.1269

Shah, S. T., Mohamed, M., & Mohamed, A. (2026). Benchmarking and mitigating answer leakage in LLM tutoring under persistent student pressure. In *Proceedings of the 28th Western Canadian Conference on Computing Education* (pp. 1–7). ACM. https://doi.org/10.1145/3828792.3828794

Shih, B., Koedinger, K. R., & Scheines, R. (2008). A response time model for bottom-out hints as worked examples. In *Proceedings of the 1st International Conference on Educational Data Mining (EDM 2008)*. https://www.educationaldatamining.org/EDM2008/uploads/proc/12_Shih_35.pdf

Srivatsa, K. V. A., Maurya, K. K., & Kochmar, E. (2025). LLMs cannot spot math errors, even when allowed to peek into the solution. In *Proceedings of the 2025 Conference on Empirical Methods in Natural Language Processing* (pp. 10914–10928). Association for Computational Linguistics. https://doi.org/10.18653/v1/2025.emnlp-main.553

Tall, D., & Vinner, S. (1981). Concept image and concept definition in mathematics with particular reference to limits and continuity. *Educational Studies in Mathematics, 12*(2), 151–169. https://doi.org/10.1007/BF00305619

Tetzlaff, L., Simonsmeier, B., Peters, T., & Brod, G. (2025). A cornerstone of adaptivity – A meta-analysis of the expertise reversal effect. *Learning and Instruction, 98*, Article 102142. https://doi.org/10.1016/j.learninstruc.2025.102142

Weber, K. (2001). Student difficulty in constructing proofs: The need for strategic knowledge. *Educational Studies in Mathematics, 48*(1), 101–119. https://doi.org/10.1023/A:1015535614355

> 若文档坚持引用 2010 年的重印章节而非 2008 年会议论文，可将 Shih 条目替换为：
> Shih, B., Koedinger, K. R., & Scheines, R. (2010). A response-time model for bottom-out hints as worked examples. In C. Romero, S. Ventura, M. Pechenizkiy, & R. S. J. d. Baker (Eds.), *Handbook of educational data mining* (pp. 201–211). CRC Press. https://doi.org/10.1201/b10274-17

### B2. 中文文献（单独排列）

**当前《设计原理说明》的全部引用均为英文文献，没有中文文献条目。** 本节暂时为空——不臆造中文文献。若评审要求补充中文来源（例如国内数学分析教学或证明教学的中文实证研究、课程标准类文件），请提供候选清单，我再逐条核实后再加入；APA 7 的规定是外文文献在中文文档中仍保留原文，不译成中文。

---

## C. 风险提示（哪些数字/表述不宜直接使用，以及更稳妥的写法）

**C-1（高）Bastani 的 48% / 17% 是「相对对照组」的百分比，不是百分点，且不能与 127% 混写。**
原文是 practice 阶段 GPT Base 相对对照组 +48%（GPT Tutor +127%），exam 阶段 GPT Base 相对对照组 −17%（绝对差 0.054/1）。文档现在写「使练习成绩提高 48%，撤除后考试成绩反而下降 17%」，读起来容易被理解为「下降了 17 个百分点」。稳妥写法：「练习阶段，无护栏组的练习成绩比对照组高 48%（护栏组高 127%）；撤除 AI 后的独立考试中，无护栏组反而比对照组低 17%，护栏组与对照组无统计差异。」
另有一个容易写错的地方：**护栏组只是消除了负效应，并没有让学生考得更好**（原文 "though we still do not observe a positive effect"）。不要写成「护栏提升了学习」。

**C-2（高）Nieveen（1999）是「三项标准」，不是「四项标准」。**
原文摘要明确写 "consisting of the following **three** criteria: validity, practicality and effectiveness"。文档 §7 写「按教育设计研究常用的四项标准评估（Nieveen 1999；McKenney & Reeves 2019）」缺乏依据。两种改法：
- 改为三项：「按 Nieveen（1999）的三项质量标准——有效性（validity）、实用性（practicality）、效果（effectiveness）——评估原型」；或
- 保留四项，但换引文：「四项标准（相关性/一致性/实用性/效果性）见 Nieveen 与 Folmer（2013）对 Nieveen（1999）的发展」，其完整出处为：Nieveen, N., & Folmer, E. (2013). Formative evaluation in educational design research. In T. Plomp & N. Nieveen (Eds.), *Educational design research: An introduction* (pp. 152–169). SLO.
这一条是本次核验中**最实质的引文错误**，建议务必修改。

**C-3（高）Shih 的年份是 2008（会议论文）或 2010（手册章节），不是「Shih 2010」这样笼统。**
原始出处为 EDM 2008 会议论文；2010 年收入 *Handbook of Educational Data Mining* 第 14 章，pp. 201–211。若正文写「Shih 等 2010」，应改为「Shih 等（2008/2010）」并补文献表条目。另需注意：该研究是 **39 名学生的相关性证据（r ≈ 0.5）**，不能写成因果结论「停留思考导致学习提升」。

**C-4（高）17.8% 泄题率的适用语境必须限定，不能暗示「数学证明辅导也已验证」。**
来源是 Shah 等（2026）的**计算机科学选择题**辅导实验（150 题、900 段对话、6 轮对抗性施压），不是证明辅导，也不是数学学科。稳妥写法：「在一项计算机科学选择题辅导的对抗性测试中，即使加了双代理审查，会话级泄题率仍有 17.8%（Shah 等，2026）。」并把它作为**风险提示**（说明必须实测），而不是当作本平台 17.8% 的成绩。

**C-5（中）QEDBench 的具体偏宽数值随版本变化，不能跨版本混用。**
PMLR v306 摘要写 "up to **+0.28** mean score inflation"（Claude 4.5 Opus）；arXiv v3 摘要写 "up to **+0.18, +0.20, +0.30, +0.36**"（分别对应 Claude Opus 4.5、DeepSeek-V3、Qwen 2.5 Max、Llama 4 Maverick）。若正文要引具体数字，必须注明版本（如「PMLR 版摘要」或「arXiv v3」），或干脆只写定性结论「LLM 评委系统性偏宽」。另注意该文同时报告 Llama 4 Maverick 通过率 90.2% vs 人工 67.7%——这才是「偏宽」最直观的证据。

**C-6（中）Mahinpei 等（2026）是单个课程的 case study，不能写成普遍规律。**
研究对象是一门本科证明课程的 TA 评分工况（o3-mini 管线、两个 LLM 实例 + 第三实例裁决）。「LLM 偏离参考解即扣分」应写成「该案例观察到 LLM 评分对偏离教师参考解的解法更严格」，并可补一句「提示评分细则需显式允许等价解法」。

**C-7（中）Schulz & Voermanek（2025）不是数学分析证明的研究，且是观察性设计。**
样本是 322 名师范生、任务为数字转换（不同进制/单位换算），help abuse 为自报，help-seeking 为日志观察，属于中介分析而非随机实验。稳妥写法：「在一项交互学习环境的观察研究中，分步提示的使用与学习成绩负相关，而策略性帮助没有这种负效应（Schulz & Voermanek, 2025）。」不要写成「分步提示导致学习变差」。

**C-8（中）Aleven 等（2016）是回顾性综述，头条结论是「改善求助行为 ≠ 提升成绩」。**
「帮助滥用普遍且与学习负相关」在文中是对其 2006 年研究的回顾（原文："presented in our IJAIED 2006 shows this behavior to be both frequent and negatively correlated with learning"）。引用时建议写成「Aleven 等（2016）回顾其实证研究指出……」；同时可把「Help Tutor 改善了求助行为但未提升学习成绩」作为**对平台的重要警示**（只做提示分级不一定提升成绩）。

**C-9（中）Tall & Vinner 的那句话是二次引用。**
原文："…induces in many individuals the notion that sₙ cannot be equal to s (see Schwarzenberger and Tall, 1978)." 严格说这是 Tall & Vinner 转述 Schwarzenberger & Tall（1978）的发现。稳妥写法：「Tall 与 Vinner（1981）在讨论概念意象时引述 Schwarzenberger 与 Tall（1978）的发现：『任意接近』式的口头定义会让许多学生认为 sₙ 不能等于 s。」另题名必须含副标题 "with particular reference to limits and continuity"。

**C-10（中）Kestin 的效应量有多个口径，写「d = 0.63」不完整。**
原文：OLS 回归效应量 0.63，作者明说被天花板效应低估；分位数回归给出 0.73–1.3 SD。若正文只写一个数，建议写「0.63（OLS，因天花板效应为下限）」。另外该文明确声明结论**不能外推**到需要复杂综合与高阶批判性思维的情境，写「AI 辅导优于课堂主动学习」时应加「在该入门物理课、该类学习目标下」。

**C-11（低）Tetzlaff 的 d 值建议用精确值。**
0.505 / −0.428 是原文值；文档的 +0.51/−0.43 是四舍五入，可用，但正式报告建议标注精确值。「不对称」是作者结论（|0.505| > |0.428|），可以保留。

**C-12（低）文献表与正文不一致的硬伤，需要在交付前统一。**
- 正文「依据」表引用了 **Schulz 2025、Shih 2010、Mahinpei 2026、Kirschner 2006、Fyfe 2014** 五条，但第 10 节文献表里**一条都没有**；Word 版必须补齐（B1 已备好）。
- 正文出现「Selden & Selden 2013/**2017**」——2017 年在文献表中不存在。若指另一篇，请给出；否则删掉「/2017」。
- 正文「Selden & Selden 2013」被用来支撑「证明 = 形式框架 + 解题核心」，但 **proof framework（证明框架）这一概念出自 Selden & Selden（1995）**（*Educational Studies in Mathematics, 29*(2), 123–151, https://doi.org/10.1007/BF01274210）。稳妥写法：「证明既需要形式框架，也需要问题解决的策略知识（Selden & Selden, 1995, 2013；Weber, 2001）」。
- 正文中「QEDBench 2026」「Bastani 等，PNAS 2025」等行文与文献表要一一对应。

**C-13（低）Srivatsa 的页码以 ACL 官方为准。**
ACL Anthology 官方 bib 记 **pp. 10914–10928**；Crossref 该条记 10925–10939（与官方不一致，疑为 Crossref 元数据错误）。引用时用 10914–10928。

**C-14（低）McKenney & Reeves 的年份。**
第 2 版印刷版权年 **2019**，电子版 2018-09 上线，部分数据库标 2018。APA 写 2019 正确；若审稿人追问可注「(2nd ed., 2019; eBook 2018)」。

**C-15（低）不要用 2010 年 RUME 会议版的「六维」冒充 2012 年 ESM 的「七维」。**
两版模型不同：2010 RUME 会议论文是 **6 个维度**（无 "logical status of statements and proof framework"，且把 higher-level ideas 与 modular structure 合并）；2012 ESM 正式发表版是 **7 个维度**。文档写「七维」正确，但列名称时要用 A1 第 9 行那七项。

---

## D. 补充文献（3–6 篇证明写作/证明理解教学经典，逐条核实）

> 这 6 篇都能在出版社页面核实到完整元数据；均已按 APA 7 写入 B1。下面给出「支撑文档哪一节」的具体说明。

| # | 文献 | 元数据核对结果 | 关键原文摘录 | 支撑文档哪一节 / 怎么用 |
|---|---|---|---|---|
| D1 | Moore, R. C. (1994). Making the transition to formal proof. *Educational Studies in Mathematics, 27*(3), 249–266. | **已核实**（DOI 10.1007/BF01273731） | "An inductive analysis of the data revealed three major sources of the students' difficulties: (a) concept understanding, (b) mathematical language and notation, and (c) getting started on a proof." | **§1 问题陈述**：说明大一/大二学生证明困难的三大来源，正好对应平台「概念—语言—起步」三类提问（H0–H4 的问题类型可据此分类）。 |
| D2 | Weber, K. (2001). Student difficulty in constructing proofs: The need for strategic knowledge. *Educational Studies in Mathematics, 48*(1), 101–119. | **已核实**（DOI 10.1023/A:1015535614355） | "undergraduates often are aware of and able to apply the facts required to prove a statement but still fail to prove it… I have hypothesized four types of 'strategic knowledge' — knowledge of how to choose which facts and theorems to apply." | **§1 + §3 设计原则**：证明「知道事实 ≠ 会证明」，缺少的是策略知识（选定理、选方法），因此平台提问应指向**策略选择**，而不是复述定义。是「AI 只提问」的最强理论依据之一。 |
| D3 | Selden, A., & Selden, J. (2003). Validations of proofs considered as texts: Can undergraduates tell whether an argument proves a theorem? *Journal for Research in Mathematics Education, 34*(1), 4–36. | **已核实**（DOI 10.2307/30034698；NCTM 页面确认 pp. 4–36） | "such undergraduates tend to focus on surface features of arguments and that their ability to determine whether arguments are proofs is very limited—perhaps more so than either they or their instructors recognize." | **§1 问题陈述 + §7 评估方案**：说明「读懂/判断证明」本身是薄弱环节，评估不能只测「会不会写」，要测「会不会读与判」。可支撑 §7 把「证明理解测验」列为次要结果指标。 |
| D4 | Alcock, L., & Inglis, M. (2008). Doctoral students' use of examples in evaluating and proving conjectures. *Educational Studies in Mathematics, 69*(2), 111–129. | **已核实**（DOI 10.1007/s10649-008-9149-x） | "we observe that the students exhibited strikingly different degrees of example use, and argue that previously observed individual differences in reasoning strategies may exist at the expert level." | **§3 设计原则**：专家在评价与证明猜想时**大量使用例子**，且个体差异显著；支撑平台设置「先举例子/找反例」类提问（语义策略），并允许学生走不同路径。 |
| D5 | Dawkins, P. C., & Roh, K. H. (2016). Promoting metalinguistic and metamathematical reasoning in proof-oriented mathematics courses: A method and a framework. *International Journal of Research in Undergraduate Mathematics Education, 2*(2), 197–222. | **已核实**（DOI 10.1007/s40753-016-0027-0） | "we argue that proof-oriented instruction must simultaneously help students understand problems of ambiguity and reference — which requires them to engage in what we call metalinguistic and metamathematical reasoning." | **§3 设计原则**：直接支撑「提问要针对语言与指称的歧义」（如量词顺序、'任意'与'存在'的指称），也可为 H 级提示中「澄清语句含义」类问题提供理论依据。 |
| D6 | Mejía-Ramos, J. P., Lew, K., de la Torre, J., & Weber, K. (2017). Developing and validating proof comprehension tests in undergraduate mathematics. *Research in Mathematics Education, 19*(2), 130–146. | **已核实**（DOI 10.1080/14794802.2017.1325776） | "we describe and illustrate the process by which we developed and validated short, multiple-choice, reliable tests to assess undergraduate students' comprehension of three mathematical proofs." 短版 12 题、20 分钟内可完成、Cronbach's α > .7。 | **§7 评估方案**：给出一条**可直接落地**的证明理解测验路线（短版 12 题、约 20 分钟、α > .7），把 §7 的「证明理解测验」从概念变成可执行方案。 |

---

## E. 未找到 / 仍需确认的条目

1. **无「未找到可靠来源」条目。** 17 条被点名核验的文献 + 17.8% 数字来源，全部在权威来源中定位到。
2. **仍待文档作者确认的 3 处**：
   - 「Selden & Selden 2013/2017」中的 **2017** 指哪一篇？（未能在文献表中定位；若指 2013 年 TME 文章的某次年重印，请给出准确出处。）
   - 正文「按 Mejía-Ramos 七维」是否准备在 §7 列出七维名称？若要列，请使用 A1 第 9 行的原文名称。
   - §7「四项标准」最终选三项（Nieveen, 1999）还是四项（Nieveen & Folmer, 2013）？二者不能混引。
3. **Shih 页码记录冲突**：Crossref 同时存在 10.1201/b10274-17（有作者，pp. 201–211）与 10.1201/b10274-21（无作者，pp. 223–234）两条记录；经核对 *Handbook of Educational Data Mining* 目录，第 14 章起始页为 **201**，故采用 pp. 201–211。若引用 2010 章节建议用此页码；更稳妥是直接引 2008 年 EDM 会议论文。
4. **QEDBench 版本差异**：arXiv v3 与 PMLR v306 摘要中的偏宽数值不同（见 C-5），正式引用请固定一个版本。

---

### 附：核验方法与证据来源（可复现）

- DOI 元数据：Crossref REST API（`https://api.crossref.org/works/{DOI}`），逐条取标题/作者/卷期页/文章号/出版年；共核 DOI 15 个。
- 正文核对页：PNAS（10.1073/pnas.2422633122）、Nature（10.1038/s41598-025-97652-6）、Springer（Tall & Vinner、Tetzlaff、Aleven、Kirschner 条目、Fyfe、Mejía-Ramos 2012、Moore、Alcock & Inglis、Nieveen 章节）、ScienceDirect（Tetzlaff 卷 98 目录）、Taylor & Francis / Routledge（McKenney & Reeves、Kirschner）、ACL Anthology（Srivatsa，官方 bib 页码）、PMLR v306（QEDBench BibTeX 与页码）、arXiv（Mahinpei 2602.23635、QEDBench 2602.20629）、NCTM/JSTOR（Selden & Selden 2003 页码）、ERIC（Kirschner、Srivatsa、Selden 辅助核对）。
- 七维名称：下载 Mejía-Ramos 等（2012）Rutgers 作者版 PDF，逐条摘录 §5.1「Summary of assessment model」原文。
- 中文文献：本次未纳入（现有引用均为英文；不臆造）。
