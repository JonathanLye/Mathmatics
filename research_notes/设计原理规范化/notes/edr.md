# EDR 方法论核查笔记（供《证明陪练场·设计原理说明》v3 规范化使用）

- 用途：为 `证明陪练场_产品设计工作区/09-设计原理说明书/index.html` 的改稿提供**可核查的方法论依据、原文引文、结构映射与术语建议**。
- 核查日期：2026-11-02。
- 核查方式：抓取并本地解析原始 PDF（van den Akker 1999 原书、Plomp & Nieveen 2013 Part A、McKenney & Reeves 2015 章节预印本、Sandoval 2014 作者版 PDF），逐一在 PDF 中定位引文与书内页码；中文文献只核到期刊官网/维普/CNKI 的书目页与摘要页（未通读全文，见 §F 说明）。
- 写作纪律：**引文只在原文 PDF 中核对过才引用**；无法核实的说法一律列入 §F「未找到可靠来源 / 待核」。所有引文保留英文原句，中文释义为本文作者所加，不冒充原文。

---

## 0. 结论速览（改稿前先看这 9 条）

1. **"设计要求 vs 设计原则"不是 EDR 的标准二分。** 英文里确实有 `design requirements`（设计必须满足的标准/约束）与 `design propositions`（"怎么做、为什么"的方案性主张）的区分，出处是 McKenney & Reeves 的书（第 2 版 **Table 5.2, p. 130**），但 `design principles`（设计原则）是另一个更通用的术语（van den Akker 1999；Plomp 2013）。中文把"设计要求/设计主张（命题）"并置，是**适配性改写**，没有对应的英文标准术语对；报告里首次出现必须给英文并给定义。
2. **设计要求写错了性质。** 书里 design requirements 指"设计必须遵守的标准"，典型来自前一阶段分析得到的边界条件、机会与约束；现行 §2 的 R1–R6 混入了设计决策（R2、R3、R6），审稿人会指出"这不是 requirement，是 solution"。建议拆成"约束性要求"与"设计决策"两张表（见 §B）。
3. **van den Akker 1999 的原文不是**"If you want to achieve X in context Y, then you had better use design principle Z, because..."。原文是 p. 9 的 `"If you want to design intervention X [for the purpose/function Y in context Z], then you are best advised to give that intervention the characteristics A, B, and C [substantive emphasis], and to do that via procedures K, L, M [procedural emphasis], because of arguments P, Q, and R."`。任务里那句常见表述是把 van den Akker 与 van Aken (2004) 的"技术规则"混在一起的二手转述，**不能当作 van den Akker 原文引用**。
4. **Nieveen (1999) 原文是三项标准，不是四项。** 1999 章（pp. 125–136）的框架是 `validity, practicality, effectiveness`，其中 validity = content validity（≈relevance）+ construct validity（≈consistency）。**四项标准表（relevance / consistency / practicality / effectiveness）出自 Plomp (2013) 第 1 章 Table 2（p. 29）**，注明"adapted from Nieveen, 1999; see also chapter 6"；`expected / actual` 区分来自 Nieveen & Folmer (2013, ch. 6, pp. 152–169)，Plomp 2013 p. 29 转引时标为 "(o.c., p.161)"。
5. **现行 §7 引 "Nieveen 1999；McKenney & Reeves 2019" 支撑四项标准，第二项很可能引错。** 本次未能在 M&R 2019 中核实到四项标准的表述；建议改为 `Nieveen (1999) + Plomp (2013, pp. 28–29) + Nieveen & Folmer (2013, pp. 152–169)`，并保留 expected/actual 的限定。
6. **Sandoval (2014) 原文没有 "indicators（指标）" 这个词。** 猜想地图的六个要素是 high-level conjecture / embodiment / mediating processes / outcomes / design conjectures / theoretical conjectures（p. 21 起）；中介过程的两种证据是 "observable interactions" 与 "artifacts ... proxies"（p. 23）。报告里的"可操作化指标"应写成团队自己的操作化说明，并注明"指标（indicators）为本报告的操作性改写，非 Sandoval 原文术语"。
7. **设计原则与猜想地图是两套东西，不能互相替代。** Bakker & Smit (2018) 明确指出：van den Akker 格式的设计原则**不指定中介过程**，而猜想地图**必须显式写出中介过程**。报告同时用两套框架是对的，但正文要说清分工：§3 原则 = 设计知识（可迁移的启发式），§4 地图 = 本项目的检验逻辑（可证伪的因果链）。
8. **"证据等级 M/R/E/B" 不是 EDR 通行分级。** van den Akker、Plomp、Nieveen、M&R 都没有这套分级；Bakker (2019) 的评论恰恰在问"设计原则到底是价值、标准、预测、建议还是启发式，经验支持算什么"。建议把"等级"改称"证据类型"，并给每条原则写明证据链与推断跨度（见 §E-2）。
9. **中文术语没有稳定对应。** 中文核心期刊里"设计原则"通行，"迭代"通行，"形成性评价"有官方译本（王其云等，2017）支撑；但"猜想地图 / 设计猜想 / 理论猜想 / 中介过程"**未找到中文核心期刊的可靠用例**，"设计命题"在设计教育里常指"设计课题/设计任务书（design brief）"，"设计主张"在中文教育研究中常指教师的"教学主张"。建议首次出现一律中英并置（见 §D、§E-4）。

---

## A. 三套（实为四套）框架的准确文献条目、原文摘录与用途

> 页码说明：所有英文页码均为**纸质书/期刊印刷页码**，已通过 PDF 内页页眉或出版社前置目录核对；无法核对的会注明"章/节"而不给页码。

### A1. McKenney & Reeves：EDR 通用模型、design requirements、design propositions、design principles

**文献条目（APA 7）**

- McKenney, S., & Reeves, T. C. (2019). *Conducting educational design research* (2nd ed.). Routledge.
- McKenney, S., & Reeves, T. C. (2015). Educational design and construction: Processes and technologies. In B. Gros, Kinshuk, & M. Maina (Eds.), *The future of ubiquitous learning: Learning designs for emerging pedagogies* (pp. 131–151). Springer. https://doi.org/10.1007/978-3-662-47724-3_8

**1）三阶段 + 实施与推广（generic model）**

第 2 版目录（出版社前置目录可核）：第 3 章 "Toward a generic model for educational design research"（**p. 67** 起），其中 "Generic model for design research" 一节 **p. 82**、Figure 3.3 "Generic model for conducting design research in education" **p. 83**；第 4 章 "Analysis and exploration"、第 5 章 "Design and construction"、第 6 章 "Evaluation and reflection"、第 7 章 "Implementation and spread"（**p. 199** 起）。第 2 版 Table 5.2 "Design requirements and design propositions distinguished" 在 **p. 130**（第 1 版对应 **p. 113**）。

第 7 章 "Implementation and spread" 节开篇原文（Routledge 第 2 版电子版；只核到章节，不保证电子版页码与纸书逐页一致，引用时建议标章）：

> "The generic model for design research presented in Chapter 3 shows all three core processes (analysis and exploration; design and construction; and evaluation and reflection) interacting with practice through the (anticipation of) implementation and spread of interventions. It also suggests that the interaction generally increases as the project matures."
> （第 7 章 "Implementation and spread" 节；McKenney & Reeves, 2019）

中文释义：通用模型把三条核心过程——分析与探索、设计与建构、评价与反思——画成始终与实践相互作用，作用的中介是"实施与推广（及其预先考虑）"；项目越成熟，与实践的互动越强。

对本文件的用处：**§1、§7、§9 的总框架**。§1 末、§7 首段、§9 决策事项都应显式说"本原型处于 EDR 的 design & construction 与 formative evaluation 阶段；试点对应 evaluation & reflection；实施与推广（implementation and spread）从第一阶段起就被预先考虑"。注意：`implementation and spread` 不是"第四阶段"，而是贯穿三阶段、随项目成熟而增强的维度（原文明说 "all three core processes ... interacting with practice through the (anticipation of) implementation and spread"）。

**2）design requirements（设计要求）——书里的定义**

原文（作者机构库开放获取的章节早期版本，与书中该章内容高度一致；**引文核到章节，不核到纸书页码**）：

> "Design requirements are criteria to which the design must adhere, like 'the design must require only the materials found in a typical classroom environment or brought in for virtually no cost,' or 'the design must require only basic operations of a tablet as pre-requisite knowledge,' or 'enactment/use of the design must fit within the normal school day and not require additional class or preparation time.' Typically, design requirements pertaining to boundary conditions, opportunities and constraints that would have been identified in a previous phase of analysis."
> （McKenney & Reeves, 2015, 章节 "Refining design requirements and design propositions"）

中文释义：设计要求是**设计必须遵守的标准**，例："设计只能使用普通课堂里能找到的材料或近乎零成本的材料""设计只以平板的基本操作为先备知识""使用设计必须能嵌进正常校日，不额外占用课时或备课时间"。这类要求通常涉及**边界条件、机会与约束**，在前一阶段的分析中识别出来。

**3）design propositions（设计主张/设计命题）——书里的定义**

紧接着的原文：

> "In contrast, design propositions suggest how things can be done and why. For example, 'the design should be web-based, because this allows schools with varied technological platforms to access the materials' or 'Teacher workshops should be tailored to take place during one of the two regularly scheduled monthly team meetings.' Design propositions are typically generated through literature review, discussion in the team and discussion with stakeholders. ... In educational design literature, many terms have been used to describe the integrated, theoretical underpinnings for design, such as conjectures (Sandoval, 2004), principles (Linn et al., 2004), and frameworks (Edelson, 2002)."
> （McKenney & Reeves, 2015, 同上节）

中文释义：设计主张回答"**可以怎么做、为什么这样做**"，例："设计应基于网页，因为这样不同技术平台的学校都能访问材料""教师工作坊应安排在每月两次例会之一"。设计主张通常来自文献综述、团队讨论和与利益相关者的讨论。教育设计文献里，描述设计的"整合性理论依据"用过很多词——猜想（conjectures）、原则（principles）、框架（frameworks）。

**4）design principles（设计原则）**

M&R 书里把 design principles 作为 EDR 的**理论性产出**（第 2 章 "Contributions to theory and practice" 讨论 theoretical contributions / practical contributions 两类产出；第 1 章列 "Main outputs"）。本次没有抓到书里给 design principles 的单句定义（该章正文不在可访问预览范围内），**不虚构引文**；可引的替代是 van den Akker (1999, p. 9) 与 Plomp (2013, p. 24) 的定义（见 A2）。M&R 自己把 principles 与 conjectures、frameworks 并列为同一族"整合性理论依据"（上引 2015 章节原文），这一点足以支撑报告把"原则"和"猜想地图"并置使用。

**5）"设计要求 vs 设计主张/设计命题"的考证结论**

- 英文**确实有** `design requirements` 与 `design propositions` 的区分，且是同一本书的同一节（Table 5.2 标题即 "Design requirements and design propositions distinguished"，第 2 版 p. 130）。区分的实质：**requirements = 必须遵守的判据（约束/边界条件）；propositions = 方案性主张（怎么做 + 为什么）**。
- 但英文**没有**"设计要求 vs 设计原则"的标准二分；`design principles` 是另一个更通行、更上位的方法论术语（van den Akker 1999 的启发式陈述；Plomp 2013 区分为实质性/程序性原则）。
- 因此，中文把"设计要求"和"设计主张/设计命题"分开**本身有英文依据**（M&R 的 requirements / propositions），但**不是"EDR 通行写法"**；把"设计原则"再与"设计要求"对举，则是中文报告结构的适配性改写。**建议写法**：§2 用"设计要求（design requirements，McKenney & Reeves, 2015/2019）"；§3 用"设计原则（design principles，van den Akker, 1999）"；若确需 `design propositions` 概念，写成"设计主张（design propositions）"，并在首次出现给定义，不要把它当作与"设计要求"并列的第三类标准术语。
- **术语陷阱**：中文"设计命题"在设计教育/工业设计文献里常指"设计课题/任务书（design brief / design assignment）"（如课程"设计命题讲解与研讨"），若用它译 design propositions，会与既有用法冲突；中文"设计主张"在教育研究里又常指教师的"教学主张"。两者都不理想，建议优先用"设计主张（design propositions）"并加英文。

**对本文件的用处**：§2 重写（requirements 的性质与来源、可检验判据）、§3 首段（principles 的写法与出处）、§9 决策（把 7 项决策作为"设计要求/设计主张的细化与确认"）。

---

### A2. van den Akker (1999)：设计原则的书写格式

**文献条目（APA 7）**

- van den Akker, J. (1999). Principles and methods of development research. In J. van den Akker, R. M. Branch, K. Gustafson, N. Nieveen, & T. Plomp (Eds.), *Design approaches and tools in education and training* (pp. 1–14). Kluwer Academic Publishers.

> 核查用 PDF：书籍全文（含第 1 章 pp. 1–14、第 10 章 Nieveen pp. 125–136）可在 andymatuschak.org 的公开 PDF 取得；本次已在 PDF 第 13 页（书 p. 5）与第 17 页（书 p. 9）核对原文。

**1）实质性/程序性原则（p. 5 原文）**

> "That general aim can be specified in two more specific goals that apply to those approaches in various degrees: (a) providing ideas (suggestions, directions) for optimizing the quality of the intervention to be developed; (b) generating, articulating and testing design principles. These principles can be of a 'substantive' nature, referring to characteristics of the intervention (what it should look like), or of a 'procedural' nature (how it should be developed)."
> （van den Akker, 1999, p. 5）

中文释义：发展研究有两个更具体的目标：(a) 为优化干预质量提供想法/方向；(b) 生成、表述并检验设计原则。原则可以是"实质性的"（干预应具备什么特征、看起来该是什么样），也可以是"程序性的"（应怎样开发）。

**2）设计原则的书写格式（p. 9 原文，核心引文）**

> "The major knowledge to be gained from development research is in the form of (both substantive and methodological) 'design principles' to support designers in their task. Those principles are usually heuristic statements of a format such as: 'If you want to design intervention X [for the purpose/function Y in context Z], then you are best advised to give that intervention the characteristics A, B, and C [substantive emphasis], and to do that via procedures K, L, and M [procedural emphasis], because of arguments P, Q, and R.'"
> （van den Akker, 1999, p. 9）

中文释义：发展研究的主要知识产出是（实质性+方法论的）"设计原则"，用来支持设计者。原则通常是启发式陈述，格式如："**如果你想设计干预 X（为了目的/功能 Y，在情境 Z 中），那么最好让该干预具备特征 A、B、C（实质性重点），并通过程序 K、L、M 来实现（程序性重点），因为论据 P、Q、R。**"

**3）原则需要论证与经验证据（p. 9 原文）**

> "However, the value of that knowledge will strongly increase when justified by theoretical arguments, well-articulated in providing directions, and convincingly backed-up with empirical evidence about the impact of those principles."
> （van den Akker, 1999, p. 9）

中文释义：这类知识若能被理论论证、被清晰表述为可操作的方向、并有关于原则影响的经验证据，其价值会大大增加。——这句非常适合放在 §3 引言，说明为什么每条 DP 要带"依据"。

**4）"If you want to achieve X in context Y, then you had better use design principle Z, because ..." 的出处辨析（重要）**

- 本次**未找到** van den Akker (1999) 使用这一句式。原文是上引"design intervention X ... characteristics A, B, C ... procedures K, L, M ... arguments P, Q, R"。
- 与之相似、常被混引的是 **van Aken (2004) 的"技术规则"**：`"if you want to achieve Y in situation Z, then something like action X will help"`（van Aken, 2004, p. 227；本次经 Gregor, Chandra Kruse & Seidel 的 *Research Perspectives: The Anatomy of a Design Principle* 与 Cronholm & Göbel 2018 两份二手文献核对，二者均逐字引用并给出页码）。
- Plomp (2013, p. 24) 对 van den Akker 格式的转写是：`"If you want to design <intervention X> for the <purpose/function Y> in <context Z>, then you are best advised to give <that intervention> the <characteristics A, B, and C> [substantive emphasis], and to do that via <procedures K, L, and M> [procedural emphasis], because of <arguments P, Q, and R>."`
- **建议**：报告若沿用"情境—目的—特征—依据"的四段式，可以写"按 van den Akker (1999, p. 9) 的启发式句式（本文简写为'情境—目的—特征—依据'）"；**不要**把 "if you want to achieve X ... then you had better use Z" 当作直接引语，也不要标成 van den Akker 原文。

**对本文件的用处**：§3 整节的写作规范；§C 的句式模板直接由 p. 9 改写。

---

### A3. Nieveen (1999) 与 Plomp (2013)：四项质量标准、expected/actual

**文献条目（APA 7）**

- Nieveen, N. (1999). Prototyping to reach product quality. In J. van den Akker, R. M. Branch, K. Gustafson, N. Nieveen, & T. Plomp (Eds.), *Design approaches and tools in education and training* (pp. 125–136). Kluwer Academic Publishers. https://doi.org/10.1007/978-94-011-4255-7_10
- Plomp, T. (2013). Educational design research: An introduction. In T. Plomp & N. Nieveen (Eds.), *Educational design research – Part A: An introduction* (pp. 10–51). SLO. https://www.slo.nl/publish/pages/4474/educational-design-research-part-a.pdf
- Nieveen, N., & Folmer, E. (2013). Formative evaluation in educational design research. In T. Plomp & N. Nieveen (Eds.), *Educational design research – Part A: An introduction* (pp. 152–169). SLO.

**1）Nieveen (1999) 原文：三项标准（不是四项）**

> "This chapter provides a framework for product quality consisting of the following three criteria: validity, practicality and effectiveness ..."
> （Nieveen, 1999, p. 125, Abstract）

> "The components of the material should be based on state-of-the-art knowledge (content validity) and all components should be consistently linked to each other (construct validity). If the product meets these requirements it is considered to be valid. ... This means that consistency should exist between the intended and perceived curriculum and the intended and operational curriculum. If both consistencies are in place, we call these materials practical. ... A third characteristic of high quality materials is that students appreciate the learning program and that desired learning takes place."
> （Nieveen, 1999, pp. 127–128；Table 2 "Linking quality aspects and curriculum representations" 在 p. 127）

中文释义：1999 年的框架是三项：**有效性（validity = 内容效度 content validity + 结构效度 construct validity）、实用性（practicality = 预期课程与实际感知/实施课程一致）、成效（effectiveness = 预期课程与学生体验/达成课程一致）**。注意 1999 原文没有把 relevance、consistency 单独列成两项，而是放在 validity 之下的两个子维度，并用"content validity / construct validity"命名。

**2）四项标准的正式表述：Plomp (2013) 第 1 章 Table 2, p. 29**

Plomp (2013, pp. 28–29) 先转述 Nieveen (1999) 的三项标准，再引入 Nieveen & Folmer (2013) 的 expected/actual 区分，最后给出**四项标准表**（原文注明 "adapted from Nieveen, 1999; see also chapter 6"）：

> Table 2. Criteria for high quality interventions (adapted from Nieveen, 1999; see also chapter 6)
> - **Relevance (also referred to as content validity)**: There is a need for the intervention and its design is based on state-of-the-art (scientific) knowledge.
> - **Consistency (also referred to as construct validity)**: The intervention is 'logically' designed.
> - **Practicality**: Expected — The intervention is expected to be usable in the settings for which it has been designed and developed. Actual — The intervention is usable in the settings for which it has been designed and developed.
> - **Effectiveness**: Expected — Using the intervention is expected to result in desired outcomes. Actual — Using the intervention results in desired outcomes.
> （Plomp, 2013, p. 29）

同页还有"**逻辑层级**"的原文，很适合写进 §7：

> "Given the character of design research, these four criteria suggest a logical hierarchy as can be illustrated by 'rhetoric' questions like: · if an intervention is not practical, why would it make sense to investigate its effectiveness? · if an intervention is not well designed (i.e. not consistent), why would it make sense to investigate its practicality?"
> （Plomp, 2013, p. 29）

**3）expected / actual 的出处与限定**

Plomp (2013, p. 29) 明确：`expected practicality / expected effectiveness` 只有在目标用户**实际使用过**干预后才可能拿到 `actual` 数据；专家评审、材料讨论只能得到"预期"数据（原文标 "(o.c., p.161)"，即 Nieveen & Folmer, 2013 章内页码）。这对报告 §7 极关键：**原型阶段的"实用性/有效性"只能是 expected；"试点"才可能报告 actual（且若未做完整田野试验，仍只能报告部分 actual）**。

**4）中文译名核对**

| 英文 | 报告现译 | 核对结论 | 建议 |
|---|---|---|---|
| relevance（= content validity） | 相关性 | 语义有偏差：此处指"干预是否有需求、是否基于最新知识"，不是统计"相关" | **适切性 / 需求性 / 关联性**；首次给英文 |
| consistency（= construct validity） | 一致性 | 基本准确，指"设计内部逻辑一致" | 一致性（构造效度）；可加"逻辑连贯" |
| practicality | 实用性 | 基本准确（可用、可嵌入正常条件） | 实用性 / 可行性 |
| effectiveness | 有效性 | 基本准确（达成预期结果） | 有效性 / 成效 |

> 中文官方译本可参考：王其云、祝智庭、顾小清主编《教育设计研究（理论与案例）》（华东师范大学出版社，2017，ISBN 9787567550339），该书是 Plomp & Nieveen 2013 Part A 的中文版（含全部七章 + 13 个案例），其目录第六章即"教育设计研究中的形成性评价"（可确认 formative evaluation 译"形成性评价"）。本次未核对该书内页对四项标准的具体译法，引用时建议标注"中译本"并自行核对页码。

**对本文件的用处**：§7 整节（四项标准的定义、层级、expected/actual）；§8 局限（"当前只能报告预期实用性/预期有效性"）。**不要**再把四项标准直接挂到 M&R 2019 名下（见 §F-3）。

---

### A4. Sandoval (2014)：猜想地图、四类体现要素、设计猜想/理论猜想

**文献条目（APA 7）**

- Sandoval, W. (2014). Conjecture mapping: An approach to systematic educational design research. *Journal of the Learning Sciences, 23*(1), 18–36. https://doi.org/10.1080/10508406.2013.778204

**1）猜想地图是什么（p. 20）**

> "Here I describe a technique for conceptualizing design research that I call conjecture mapping, a means of specifying theoretically salient features of a learning environment design and mapping out how they are predicted to work together to produce desired outcomes."
> （Sandoval, 2014, p. 20）

中文释义：猜想地图是一种把"学习环境中理论上关键的特征"明确写出来、并标出它们**预期如何共同作用以产生期望结果**的技术。

**2）高层猜想 high-level conjecture（p. 21）**

> "By high-level conjecture, I mean this sort of theoretically principled idea of how to support some desired form of learning, articulated in general terms and at too high a level to determine design. Such conjectures or meta-principles (Kali, 2006) are usually the result of some initial problem analysis (cf. Edelson, 2002)."
> （Sandoval, 2014, p. 21）

中文释义：高层猜想是"有理论依据的、关于如何支持某种期望学习形态的想法"，表述得很概括，高到无法直接决定设计；这类猜想（或曰元原则，Kali, 2006）通常来自最初的问题分析（参 Edelson, 2002）。

**3）体现（embodiment）与四类要素（p. 22）**

> "The embodiment of the high-level conjecture articulates its reification in features of the learning environment design. Conjectures can be embodied within four kinds of elements of learning environments: tools and materials, task structures, participant structures, and discursive practices."
> （Sandoval, 2014, p. 22）

同页对四类要素的定义（原文）：

> "Task structure refers to the structure of the tasks learners are expected to do—their goals, criteria, standards, and so on. Participant structure refers to how participants (e.g., students and teachers) are expected to participate in tasks, the roles and responsibilities participants take on. A final element of design includes intended discursive practices—ways of talking, in the simplest sense."
> （Sandoval, 2014, p. 22）

中文释义：高层猜想"体现"为学习环境设计中的具体特征。四类要素：**工具与材料（tools and materials）、任务结构（task structures）、参与结构（participant structures）、话语实践（discursive practices）**。任务结构 = 学习者被期望完成的任务的结构（目标、标准、要求等）；参与结构 = 参与者（学生、教师）被期望如何参与任务、承担什么角色与责任；话语实践 = 被期望的"说话方式"。

**4）中介过程 mediating processes（p. 23）**

> "Designs do not lead directly to outcomes. An airplane produces flight as an outcome to the extent that it generates sufficient lift, a mediating process required to produce the outcome. In learning environments, the use of particular tools for specific tasks enacted in specific ways is intended to produce certain kinds of activity and interaction that are hypothesized to produce intended outcomes. ... I label them processes to emphasize the process–outcome link of concern to design research."
> （Sandoval, 2014, p. 23）

> "The first way includes observable interactions between participants and the designed environment. ... The second way to understand mediating processes is to analyze artifacts that participants produce from their activity. Such artifacts are proxies for learning processes; they indicate the extent to which learners are engaged in the sort of activity and thinking hypothesized to matter. I would argue that documenting mediating processes in at least one of these two ways is required to connect aspects of a designed learning environment to observed outcomes of its use."
> （Sandoval, 2014, p. 23）

中文释义：设计不直接产生结果（飞机产生飞行，是因为先产生足够的升力——升力就是中介过程）。中介过程是设计意图引发的活动与互动；**两种记录方式：可观察的互动（observable interactions）与参与者产出的制品（artifacts，作为学习过程的代理指标）**；至少要记录其中一种，才能把设计要素与观察到的结果连起来。

**5）设计猜想 vs 理论猜想（p. 24，核心引文）**

> "Design conjectures take the general form 'if learners engage in this activity (task + participant) structure with these tools, through this discursive practice, then this mediating process will emerge.' ... Theoretical conjectures in a conjecture map take the general form 'if this mediating process occurs it will lead to this outcome.'"
> （Sandoval, 2014, p. 24）

中文释义：**设计猜想**的句式："如果学习者借助这些工具、通过这种话语实践，参与这种活动（任务+参与）结构，那么这种中介过程会出现。" **理论猜想**的句式："如果这种中介过程发生，就会导致这种结果。" 两类猜想分别对应"设计—过程"与"过程—结果"两段因果链，各自需要不同类型的数据来检验。

**6）关于 "indicators（指标）"：原文没有这个词**

- 已在 Sandoval (2014) 全文检索：**未出现 `indicator(s)`**（只出现 "indicated" 一次，且是普通动词）。原文使用的是 `observable interactions`、`artifacts ... proxies`、`evidence`、`measure(s)`、`instrumentation`。
- 因此报告 §4 表格里"证据：骨架通过率、首次求助前时长……"这类"指标"清单是**团队的操作性改写**，不是 Sandoval 术语。**建议**：在 §4 首次出现"指标"时写"本报告把中介过程的操作性证据称为'指标（indicators，本报告操作性用语；Sandoval 原文用 observable interactions / artifacts as proxies）"，并在表格标题写"可观察证据（指标）"，避免审稿人误以为 Sandoval 有 indicators 分类。
- 另外，Sandoval 在 p. 24 明确指出 measurement/instrumentation 是设计研究常被忽视的方面（"instrumentation is a neglected aspect of design research"），这句可以支撑报告"指标要在试点前定义好"的做法。

**对本文件的用处**：§4 整节；§5 每个画面应标"体现哪个 design conjecture"；§8 局限（中介过程证据不足时不能宣称理论猜想成立）。

---

### A5. 其他可引用的 EDR 方法文献（按报告用途筛选）

| 文献（APA 7） | 一句话贡献 | 适合放在报告哪节 / 建议 |
|---|---|---|
| Edelson, D. C. (2002). Design research: What we learn when we engage in design. *Journal of the Learning Sciences, 11*(1), 105–121. https://doi.org/10.1207/S15327809JLS1101_4 | 论证设计研究能产出"可用的设计知识"，并把设计知识分为设计原则、设计方法、领域理论等 | §1 或 §6：说明"对照与竞品分析"属于设计研究的知识生产，不是产品评测。**建议引** |
| Design-Based Research Collective. (2003). Design-based research: An emerging paradigm for educational inquiry. *Educational Researcher, 32*(1), 5–8. | DBR 的纲领性短文，指出教育研究与实践脱节的"可信性缺口" | §1 问题陈述的经典锚点。**建议引** |
| Cobb, P., Confrey, J., diSessa, A., Lehrer, R., & Schauble, L. (2003). Design experiments in educational research. *Educational Researcher, 32*(1), 9–13. | 设计实验的方法论特征（"humble theory"、学习生态、情境化理论） | §8 局限：说明本项目产出的是"局部理论"而非普遍规律。**建议引** |
| Kali, Y. (2006). Collaborative knowledge building using the Design Principles Database. *International Journal of Computer-Supported Collaborative Learning, 1*(2), 187–201. https://doi.org/10.1007/s11412-006-8993-x | 设计原则数据库；区分 Specific / Pragmatic / **Meta-Principles**（"Meta-Principles capture abstract ideas represented in a cluster of Pragmatic Principles"） | §3 或 §4：说明"高层猜想"与"元原则"同族（Sandoval p. 21 即引 Kali 2006）。**可选引** |
| Reeves, T. C. (2006). Design research from a technology perspective. In J. van den Akker, K. Gravemeijer, S. McKenney, & N. Nieveen (Eds.), *Educational design research* (pp. 52–66). Routledge. | 从教育技术角度论证设计研究、批评媒体比较研究 | §6：为"同平台对照而非媒体比较"提供依据。**建议引** |
| Plomp, T. (2013). 见 A3 | EDR 导论；阶段模型（preliminary research / prototyping phase / assessment phase）；设计原则格式；四项质量标准 | §3、§7、§8 的总引。**必引** |
| Nieveen, N., & Folmer, E. (2013). 见 A3 | 形成性评价、评价匹配板、expected/actual | §7 的形成性评价设计。**必引** |
| Bakker, A. (2018). *Design research in education: A practical guide for early career researchers*. Routledge. https://doi.org/10.4324/9780203701010 | 设计研究实用指南；含"design principles, conjecture mapping, and hypothetical learning trajectories"专章 | §3、§4 的二手权威。**建议引**（现行 §3 已引，保留） |
| Bakker, A., & Smit, J. (2018). Using hypothetical learning trajectories in design research. In A. Bakker, *Design research in education*. Routledge. https://doi.org/10.4324/9780203701010-25 | 明确比较设计原则与猜想地图："design principles in Van den Akker's format do not specify mediating processes, whereas they are explicit in conjecture maps"；并指出原则是"practical advisory terms"、地图更"research oriented" | §3/§4 的分工说明。**强烈建议引**（一句话解决"为什么两套框架都要"） |
| Easterday, M. W., Lewis, D. R., & Gerber, E. M. (2014). Design-based research process: Problems, phases, and applications. In J. L. Polman et al. (Eds.), *Learning and becoming in practice: ICLS 2014* (Vol. 1, pp. 317–324). International Society of the Learning Sciences. https://doi.org/10.22318/icls2014.317 | 把 DBR 定义为 6 个迭代阶段：focus → understand → define → conceive → build → test；并讨论"design arguments（Van den Akker 1999）" | §7 或 §9：可作为"阶段—产出"检查表的来源。**可选引**；注意：**没有"八项特征"**（见 §F-5） |

> 关于"Easterday et al. 2014 的八项特征"：本次核查到的是**六阶段**定义（focus, understand, define, conceive, build, test），未找到"八项特征"的说法（见 §F-5）。不要再按"八项特征"写。

---

## B. 现行 10 节结构 × 三套框架的映射建议

> 按 `09-设计原理说明书/index.html` 现行编号：摘要（不编号）+ §1 问题陈述与长期目标（含红线）+ §2 设计要求 + §3 设计原则 + §4 猜想地图 + §5 演示（画面 A–F）+ §6 与初版和通用 AI 的区别 + §7 评估方案 + §8 局限 + §9 需要罗老师确认的事项 + §10 主要参考文献。

| 节 | 现在的问题 | 建议用的框架/写法 | 正文里必须出现的方法论锚点（建议原句） |
|---|---|---|---|
| 摘要 | 只说"按教育设计研究的通行做法"，未点名框架 | M&R 通用模型 + Sandoval 猜想地图 + Nieveen/Plomp 质量标准，各一句 | "本报告按教育设计研究（educational design research）的通用模型组织：问题界定、设计要求与设计原则、猜想地图、原型与评估（McKenney & Reeves, 2019）；原型阶段的质量判断采用 relevance / consistency / practicality / effectiveness 四项标准，并区分预期与实际（Nieveen, 1999; Plomp, 2013）。" |
| §1 问题陈述与长期目标 | 有证据（Bastani）但缺方法定位；"长期目标"未接到 EDR 的阶段产出 | M&R 第 4 章 analysis & exploration：problem definition（问题界定）+ long-range goals（长期目标）+ exploration（借鉴他人如何看同类问题）；可引 DBRC 2003 的"可信性缺口" | "问题界定与长期目标是 EDR 第一阶段（分析与探索）的核心产出（McKenney & Reeves, 2019, ch. 4）。本原型目前处于设计与建构（design and construction）阶段，尚未进入评价与反思（evaluation and reflection）阶段。" |
| §2 设计要求 | R1–R6 混入设计决策；"来源"多为内部文档；无验收判据 | M&R requirements 定义（criteria to which the design must adhere；来自边界条件/机会/约束）+ Table 5.2（p. 130）；拆成"约束性要求（context-derived）"与"设计决策（solution choices）"两张表 | "设计要求是设计必须满足的标准，来自前一阶段分析识别的边界条件、机会与约束（McKenney & Reeves, 2015; 2019, Table 5.2, p. 130）。设计要求不是设计决策：前者回答'必须满足什么'，后者回答'我们选择怎么做、为什么'。" |
| §3 设计原则 | DP1–DP6 只有"特征/依据"，缺"情境/目的"；证据等级自造；原则与要求未分工 | van den Akker (1999, p. 9) 启发式句式（情境 Y—目的 X—特征 A/B/C—程序 K/L/M—论据 P/Q/R）；实质性/程序性之分（p. 5）；Plomp (2013, p. 24) 的转写；Bakker (2019) 对"原则是什么"的追问 | "每条设计原则按 van den Akker（1999, p. 9）的启发式句式书写：在情境 Y 中，为实现目的 X，宜让干预具备特征 A、B、C，并通过程序 K、L、M 实现，依据是论据 P、Q、R。" |
| §4 猜想地图 | 结构正确；但"证据"一列混用了中介过程与指标；"指标"未定义；未说明设计猜想/理论猜想各自怎么检验 | Sandoval (2014, pp. 21–24)：六要素；四类体现要素；设计猜想与理论猜想的句式；中介过程的两种证据（可观察互动/制品）；Bakker & Smit (2018) 区分原则与地图 | "猜想地图（Sandoval, 2014）用'设计猜想'（设计要素→中介过程）与'理论猜想'（中介过程→结果）两段因果链，把设计为什么可能起作用写成可检验的假设。本表第三列只列可观察的中介过程证据；'指标'是本报告的操作性用语（Sandoval 原文用 observable interactions 与 artifacts as proxies）。" |
| §5 演示（画面 A–F） | 是界面说明，未接回设计猜想；个别"为什么这样设计"混入了效果断言 | 每个画面标：对应哪个 DP + 体现哪个设计猜想（哪类要素：工具/任务/参与/话语）；用 Sandoval 四类要素给六个画面分类 | "以下画面用于说明设计要素如何体现设计猜想，不构成学习效果证据；效果检验见 §7。" |
| §6 与初版和通用 AI 的区别 | 表格是功能对比，容易被读成"我们更好" | M&R 第 4 章 exploration（"seek out and learn from how others have viewed and attended to similar problems"）；Reeves (2006) 批评媒体比较；Edelson (2002) 设计知识 | "与初版和通用 AI 的对照属于 EDR 分析探索阶段的'探索'活动：借鉴他人如何界定与处理同类问题，而不是用功能清单证明效果优势（McKenney & Reeves, 2019, ch. 4; Reeves, 2006）。" |
| §7 评估方案 | 四项标准的归属引错风险；未区分预期/实际；"证据来源"未对应形成性评价循环 | Nieveen (1999) 三标准 → Plomp (2013, Table 2, p. 29) 四标准 + expected/actual → Nieveen & Folmer (2013) 形成性评价与评价匹配板 | "原型阶段只能报告预期实用性/预期有效性；只有目标用户在目标场景中实际使用后，才能报告实际实用性/实际有效性（Nieveen & Folmer, 2013, p. 161; Plomp, 2013, p. 29）。四项标准有逻辑层级：不实用则谈有效性无意义，不一致则谈实用性无意义（Plomp, 2013, p. 29）。" |
| §8 局限 | 局限写得诚实，但未接方法论（为什么这些局限是 EDR 的常态） | Sandoval (2014, p. 23) 中介过程证据要求；Cobb et al. (2003) 局部理论；M&R 的 implementation & spread；Kali (2006) 元原则 | "猜想地图的中介过程需要可观察证据；在只有设计层面论证、尚无过程数据时，理论猜想不能被声称成立（Sandoval, 2014, p. 23）。本研究的产出是情境化的局部理论，不追求脱离情境的普遍规律（Cobb et al., 2003）。" |
| §9 需要确认的 7 项决策 | 决策清单与设计要求/实施推广未挂钩；D-08、D-10 缺方法论定位 | M&R design requirements 的确认 + implementation and spread；Plomp (2013) 的 assessment phase | "以下决策是对设计要求与实施推广（implementation and spread）条件的细化确认；其中实验设计（D-08）与伦理审查（D-10）决定本研究能否从'预期有效性'推进到'实际有效性'（McKenney & Reeves, 2019, ch. 7）。" |
| §10 主要参考文献 | 缺方法论核心条目；M&R 版本、Nieveen 页码、Plomp 缺失 | 补：van den Akker (1999)、Plomp (2013)、Nieveen & Folmer (2013)、Sandoval (2014)、Bakker & Smit (2018)；中文版可列王其云等（2017） | — |

**建议在正文中显式出现的 6 个"方法论锚点"（直接可粘贴的句子）**

1. （摘要末）"本报告的结构对应教育设计研究的通用模型：分析与探索、设计与建构、评价与反思，并把实施与推广作为贯穿始终的维度（McKenney & Reeves, 2019）。"
2. （§2 首段）"设计要求是设计必须满足的标准，而不是设计决策；它来自情境分析识别的边界条件、机会与约束（McKenney & Reeves, 2015; 2019, Table 5.2, p. 130）。"
3. （§3 首段）"每条设计原则按 van den Akker（1999, p. 9）的启发式句式书写，并区分实质性（干预应具备什么特征）与程序性（应通过什么做法实现）两类重点。"
4. （§4 首段）"猜想地图用设计猜想与理论猜想两段因果链，把'设计为什么可能起作用'写成可检验的假设（Sandoval, 2014, pp. 21–24）；设计原则与猜想地图分工不同：前者是可迁移的启发式，不指定中介过程；后者必须写明中介过程（Bakker & Smit, 2018）。"
5. （§7 首段）"原型阶段的质量判断采用 relevance、consistency、practicality、effectiveness 四项标准，并区分预期与实际（Nieveen, 1999; Plomp, 2013, pp. 28–29; Nieveen & Folmer, 2013）。"
6. （§8 首段）"本研究产出的是情境化的局部理论；在缺少中介过程证据时，只报告设计层面的论证，不宣称理论猜想成立（Sandoval, 2014, p. 23; Cobb et al., 2003）。"

---

## C. 6 条设计原则的"情境—目的—特征—依据"改写模板

### C1. 句式模板

**中文（完整版）**

> 在【情境 Y：学生/课程/平台/约束】中，若要实现【目的 X：学习目标/过程】，宜使【干预/设计】具备【特征 A、B、C（实质性）】，并通过【做法 K、L、M（程序性）】来实现，其依据是【论据 P、Q、R：理论 + 实证证据】。

**中文（表格版，适合 DP1–DP6）**

| 字段 | 写什么 | 反例（不要这样写） |
|---|---|---|
| 情境（Y） | 学习者、课程、平台、时间/制度约束；**不适用范围** | "大学生"（太宽） |
| 目的（X） | 期望的学习过程/结果，尽量可观察 | "提升能力"（不可观察） |
| 特征（A/B/C） | 干预可见的实质性特征（工具、任务、参与、话语） | "要智能"（不是特征） |
| 程序（K/L/M） | 如何实现（教师预写、闸门、分级、跳过规则……） | "用 AI"（不是程序） |
| 依据（P/Q/R） | 理论机制 + 实证证据 + 证据类型/强度 | "有文献支持"（不给文献） |
| 可检验预期 | 用设计猜想句式写出（要素→中介过程） | "应该会有效" |
| 边界条件 | 什么情况下不适用/应跳过 | 无 |

**英文（可直接引 van den Akker 1999, p. 9）**

> "If you want to design intervention X [for the purpose/function Y in context Z], then you are best advised to give that intervention the characteristics A, B, and C [substantive emphasis], and to do that via procedures K, L, M [procedural emphasis], because of arguments P, Q, and R."

### C2. 示例：把 DP3 改写成完整格式

> 选取 DP3（"大白话是一座有护栏的桥"），因为它同时有情境、机制与边界条件，最能演示格式。

**原文标题**：DP3 大白话是一座有护栏的桥：必须附失真说明，并回到定义

**改写成"情境—目的—特征—依据"：**

- **情境（Y）**：数学分析大一/大二学生，首次系统学习 ε-N 与极限的形式定义；学生已有高中阶段的"无限接近"直觉，但尚未建立"任意 ε>0……"的量词结构；平台为文字+公式输入的网页，题目包由教师预写；对象不适用于已能熟练使用定义书写证明的学生（此类学生按 DP5 跳过）。
- **目的（X）**：在引入形式定义之前，让学生获得一个**可用但不过度失真**的直观，并能在需要时把直观说法翻译回定义；具体可观察目标：学生在定义改写任务中不把"无限接近"表述为"不等于极限"，并能指出直观说法的失真之处。
- **特征（A/B/C）**：直观卡由五部分组成——一句日常语言直观；词与符号的对应表；**失真说明**（明确"无限接近"不等于"不相等"）；边界例子（如常数列）；回到定义的入口。直观卡只在学生点击"看不懂"时出现，且必须完成边界例子才能关闭；不替代定义卡。
- **程序（K/L/M）**：教师预写全部卡片文本；触发条件由界面状态控制（不懂→出现）；关闭条件绑定"边界例子作答"；学生离开该层后仍可在后续层回看，但不再自动弹出。
- **依据（P/Q/R）**：Tall & Vinner（1981）的 concept image / concept definition 区分——直觉形象会干扰形式定义的使用（实验/设计研究类证据）；Fyfe 等（2014）的具体→抽象顺序与渐隐（元分析）；van den Akker（1999, p. 5）的实质性/程序性区分（说明"卡片内容"是实质性、"触发与关闭规则"是程序性）。
- **可检验预期（设计猜想，Sandoval 句式）**："如果学生在定义层使用直观卡并完成边界例子，那么他们在随后写定义与判断反例时，更少出现把'无限接近'等同于'不相等'的中介过程（可观察证据：定义改写文本、边界例子作答、后续追问中的表述）。"
- **边界条件 / 不适用**：对已掌握定义的学生可能冗余甚至干扰 → 与 DP5 的"按实测表现跳过"联动；若试点数据显示直观卡组在后测上无差异或更差，应删除或改写（这正是 §7 要检验的）。

**改写后的一句话版（放正文）**：

> 在数学分析初学者的定义入门情境中（Y），为让学生获得可用而不过度失真的直观并能回到定义（X），直观卡宜具备"一句直观 + 词—符号对应 + 失真说明 + 边界例子 + 回到定义"五个特征（A–C），并只在学生表示"看不懂"时出现、完成边界例子才可关闭（K–M），因为直觉形象会干扰定义使用（Tall & Vinner, 1981），而具体先行、逐步渐隐有利于迁移（Fyfe et al., 2014）。

### C3. 证据标签的处理（替换现行 M/R/E/B）

现行 §3 用 `M 元分析 / R 随机对照 / E 实验或设计研究 / B 技术基准` 四档。建议改为**三列**，避免"等级"暗示：

| 列 | 例 |
|---|---|
| 证据类型 | 元分析 / 随机对照实验 / 实验或设计研究 / 技术基准 / 理论论证 |
| 证据与设计决策的距离 | 直接（同一干预成分）/ 邻近（同类学习过程）/ 间接（相关机制） |
| 适用边界 | 在什么人群、什么任务、什么条件下成立；本项目是否满足 |

这样既不否认证据强弱，也不宣称存在 EDR 通行的"证据等级表"。若罗老师课题组坚持用等级，需在脚注说明"本分级为本团队自定，参照……（写明具体框架）"，并给出每档的操作定义。

---

## D. 术语表（中 / 英 / 定义 / 出处）

> 原则：**中文首次出现一律给英文**；无稳定中译的术语（猜想地图、中介过程等）必须给英文原文，避免与中文既有用法混淆。

| 中文（建议） | 英文 | 定义（简述） | 出处（本笔记核对页码） |
|---|---|---|---|
| 教育设计研究 / 基于设计的研究 | educational design research (EDR) / design-based research (DBR) | 在真实教育情境中，通过系统的设计、开发与评价，同时产出实践解决方案与可迁移设计知识的研究取向 | Plomp (2013, pp. 10–11)；M&R (2019, ch. 1) |
| 通用模型 | generic model (for design research) | 把 EDR 刻画为分析与探索、设计与建构、评价与反思三条核心过程，并以实施与推广为贯穿维度 | M&R (2019, ch. 3, Figure 3.3, p. 83; ch. 7) |
| 分析与探索 | analysis and exploration | 界定问题、做需求/情境分析、综述文献、考察他人如何解决同类问题 | M&R (2019, ch. 4) |
| 设计与建构 | design and construction | 生成并筛选方案、画骨架设计、做原型 | M&R (2019, ch. 5) |
| 评价与反思 | evaluation and reflection | 形成性/总结性评价，并对发现做回溯性反思 | M&R (2019, ch. 6) |
| 实施与推广 | implementation and spread | 与一线实践的持续互动；从项目一开始就被"预先考虑"，随项目成熟而增强 | M&R (2019, ch. 7) |
| 设计要求 | design requirements | 设计必须遵守的标准；通常来自前一阶段分析识别的边界条件、机会与约束 | M&R (2015, ch. 5; 2019, Table 5.2, p. 130) |
| 设计主张 / 设计命题 | design propositions | "可以怎么做、为什么这样做"的方案性主张；来自文献、团队与利益相关者讨论 | M&R (2015, ch. 5) |
| 设计原则 | design principles | 关于"在什么情境、为达到什么目的、宜采取什么特征/程序、依据是什么"的启发式陈述 | van den Akker (1999, p. 9)；Plomp (2013, p. 24) |
| 实质性设计原则 | substantive design principles | 关于干预本身应具备什么特征的原则 | van den Akker (1999, p. 5) |
| 程序性设计原则 | procedural design principles | 关于应通过什么开发/实施程序来实现的原则 | van den Akker (1999, p. 5)；Plomp (2013, p. 24) |
| 猜想地图 | conjecture map | 把设计要素、中介过程与结果用设计猜想/理论猜想连接起来的可检验图示 | Sandoval (2014, pp. 21–24) |
| 高层猜想 | high-level conjecture | 有理论依据、表述概括、尚不足以决定设计的"如何支持某类学习"的想法 | Sandoval (2014, p. 21) |
| 体现 / 具体化 | embodiment | 高层猜想在学习环境设计特征中的落位 | Sandoval (2014, p. 22) |
| 工具与材料 | tools and materials | 软件、仪器、可操作材料、媒体等 | Sandoval (2014, p. 22) |
| 任务结构 | task structures | 学习者被期望完成的任务的目标、标准、要求等 | Sandoval (2014, p. 22) |
| 参与结构 | participant structures | 学生/教师如何参与任务、承担什么角色与责任 | Sandoval (2014, p. 22) |
| 话语实践 | discursive practices | 被期望的"说话方式"（提问、解释、论证的规范） | Sandoval (2014, p. 22) |
| 中介过程 | mediating processes | 设计要素引发的、处在"设计→结果"之间的活动与互动；可用可观察互动或制品作证据 | Sandoval (2014, p. 23) |
| 设计猜想 | design conjectures | "若学习者以这些工具、通过这种话语实践参与这种任务+参与结构，则这种中介过程会出现" | Sandoval (2014, p. 24) |
| 理论猜想 | theoretical conjectures | "若这种中介过程发生，则会导致这种结果" | Sandoval (2014, p. 24) |
| 结果 | outcomes | 期望的学习/态度等结果；需明确"长什么样、如何观察或测量" | Sandoval (2014, pp. 23–24) |
| 指标（操作性） | indicators（**非 Sandoval 术语**） | 本报告对中介过程的操作性证据的称呼；建议写成"可观察证据（指标）" | 本报告操作性改写；Sandoval 原文无此词 |
| 适切性 / 关联性（内容效度） | relevance (content validity) | 干预确实对应需求，且设计基于最新（科学）知识 | Plomp (2013, p. 29)；Nieveen (1999, p. 127) |
| 一致性（构造效度） | consistency (construct validity) | 干预的各个成分在逻辑上彼此连贯 | Plomp (2013, p. 29)；Nieveen (1999, p. 127) |
| 实用性 | practicality | 干预在目标场景中可用、可嵌入正常条件；分预期/实际 | Plomp (2013, p. 29) |
| 有效性 / 成效 | effectiveness | 使用干预能达成预期结果；分预期/实际 | Plomp (2013, p. 29) |
| 预期的 / 实际的 | expected / actual | 未实际使用时的判断 vs 目标用户实际使用后的判断 | Nieveen & Folmer (2013, pp. 152–169; 转引 p. 161) |
| 形成性评价 | formative evaluation | 以改进为目的、贯穿各阶段与迭代循环的评价 | Nieveen & Folmer (2013)；中译见王其云等（2017）目录第六章 |
| 迭代 | iteration | 分析—设计—评价—修订的循环 | M&R (2019)；中文用例见梁文鑫、余胜泉（2006） |
| 局部理论 / 境脉化理论 | local theory / humble theory | 与具体情境紧密绑定、不追求脱离情境普遍化的理论 | Cobb et al. (2003)；M&R (2019) |
| 设计理据 / 设计原理 | design rationale | 对"为什么这样设计"的论证与理由；不等同于 design principles | 术语建议；中文文献常用"设计理据"，本次未找到 EDR 领域的标准中译（见 §F） |

---

## E. 风险提示：哪些说法容易被教育研究者质疑

> 按"风险等级 × 修改成本"排序。每条给"质疑点 → 建议改法"。

### E-1（高）"设计要求/设计主张/设计原则"三词混用，且把设计要求写成设计决策

- 质疑：M&R 的 requirements 是"必须遵守的判据"（来自边界条件），现行 R2"保留六层结构"、R3"模型不判定对错"、R6"教师审核后可见"都是**已做的设计选择**，属于 propositions/design decisions，不是 requirements。审稿人会问："这些是分析得出的约束，还是你们的选择？"
- 改法：§2 拆两张表——**表 A 约束性要求**（来源：需求书/技术方案/课程制度/设备条件；每条给"验收判据"）；**表 B 设计决策**（对应 DP，写"选择 + 理由 + 依据"）。R1/R4/R5 可留在表 A；R2/R3/R6 移到表 B 或 §3。
- 术语：`设计要求 = design requirements`；`设计主张 = design propositions`；`设计原则 = design principles`。首次出现给英文；不要造"设计命题"（中文歧义，见 §E-4）。

### E-2（高）"证据等级 M/R/E/B"缺乏方法论依据

- 质疑：van den Akker、Plomp、Nieveen、M&R 都没有这套分级；Bakker (2019) 的评论正是在追问"设计原则到底是价值、标准、预测、建议还是启发式，什么算经验支持"。用"M/R/E/B"会给读者"这是 EDR 标准做法"的错觉；而且同一档内差异巨大（元分析也分直接/间接）。
- 改法：见 §C3 三列（证据类型 / 与设计决策的距离 / 适用边界）；或在脚注明确"本分级为本团队自定，操作定义如下……"。另注意推断跨度：例如 Tetzlaff 等（2025）是 expertise reversal 的元分析，用它支撑"按实测表现跳过层级"是**邻近证据**，不是直接证据；应写"支持该机制的元分析证据（邻近）"而非直接打 M。

### E-3（高）四项质量标准的归属与"预期/实际"未区分

- 质疑：§7 写"（Nieveen 1999；McKenney & Reeves 2019）"。Nieveen 1999 原文是三项（validity/practicality/effectiveness）；四项表在 Plomp (2013, p. 29)；M&R 2019 是否列这四项，本次**未核实**。另外"相关性"译法容易被读成统计相关。
- 改法：引 `Nieveen (1999)` + `Plomp (2013, pp. 28–29)` + `Nieveen & Folmer (2013, pp. 152–169)`；把"相关性"改为"适切性（relevance，亦称内容效度）"；明确"原型阶段只报告预期实用性/预期有效性，试点后才可能报告实际"。

### E-4（中高）中文术语的既有用法冲突

- "**猜想地图**"：中文数学教育里已有"猜想地图/猜想树"指教师画的猜想板（如课堂上的"猜想地图"），与 Sandoval 的 conjecture map 不是一回事；中文核心期刊中**未找到** Sandoval 意义上的用例。→ 首次出现写"猜想地图（conjecture map, Sandoval, 2014）"，并用一句话给定义；不要只写"猜想地图"。
- "**设计命题**"：中文设计教育里常指"设计课题/任务书（design brief）"；"**设计主张**"在中文教育研究里常指教师"教学主张"。→ 若用，必须写"设计主张（design propositions，McKenney & Reeves 用语）"；更稳的做法是只在 §3 用"设计原则"，把 propositions 作为 principles 的英文同族词在脚注交代。
- "**介中过程 / 中介过程**"：中文心理学有"中介过程（mediating process）"的用法，但 EDR 语境无稳定用例。→ 首次给英文；定义写"设计要素引发、位于设计与结果之间的活动与互动"。
- "**设计原理 vs 设计原则**"：报告标题是"设计原理说明（Design Rationale）"，§3 又用"设计原则（design principles）"。中文读者容易把两者混为一谈。→ 在 §3 开头加一句"'设计原理'指本报告对设计理由的整体说明（design rationale）；'设计原则'是其中可迁移的启发式陈述（design principles）"；或把标题改为"设计原则与理据说明"。

### E-5（中）Sandoval 框架的"指标"被当成原文术语

- 质疑：Sandoval (2014) 全文没有 `indicators`；报告表格里的"证据：……"是自造的操作化。若写成"Sandoval 的指标"，会被指出误引。
- 改法：见 §A4-6；表格列名改"可观察证据（指标）"，并注"指标为本报告操作性用语"。

### E-6（中）"0 泄题""消除负效应"等绝对化表述

- 质疑：EDR/实验研究审稿人会对"0"和"消除"敏感；且报告 §8 已承认"0 泄题只对预写文本成立""双代理审查后仍有 17.8% 泄题率"。前后矛盾。
- 改法：统一为"在本原型架构下，教师预写文本的泄题率为 0；若允许模型在线改写，只能报告实测泄题率"；把"消除负效应"改为"显著削弱/未观察到负效应（Bastani et al., 2025）"。

### E-7（中）"六层任务结构"与 Sandoval 的 task structures 不是同一层级

- 质疑：Sandoval 的 task structure 指任务的目标、标准、要求；报告的"六层"更像"教学阶段/活动序列"。直接说"六层 = task structure"会被认为概念拉伸。
- 改法：写"六层是任务结构（task structures）在本项目中的具体形态：每层的目标、产出标准与入口条件见 §5"；并在猜想地图"任务结构"格内写"六层：定义→骨架→构造→自检→迁移→总结（可跳过）"之外，补"每层的完成标准"。

### E-8（低-中）"设计原则"的可迁移性宣称过强

- 质疑：Kali (2006) 与 M&R 都强调设计原则是**情境化的启发式**，不保证跨情境成功；报告若写"这 6 条原则可推广到其他数学课程"，需要额外证据。
- 改法：写"这些原则在当前情境（数学分析、大一大二、本平台）中形成；其可迁移性需在更多情境中检验（van den Akker, 1999, p. 9; Kali, 2006）"。

### E-9（低）"同平台主动对照"的方法论定位

- 质疑：这不是 EDR 的"评价与反思"阶段的唯一选项；EDR 常用形成性评价 + 设计实验，RCT 是其中一种检验手段。报告若把它写成"EDR 的标准做法"会过度。
- 改法：写"试点采用同平台主动对照，作为评价与反思阶段中检验理论猜想的一种手段；其外部效度与伦理限制见 §8、§9"；可引 Easterday et al. (2014) 关于"在 test 阶段可嵌套其他科学过程（含随机对照）"的论述。

---

## F. 未找到可靠来源 / 待核清单（不要写进正文当引文）

1. **"If you want to achieve X in context Y, then you had better use design principle Z, because ..."**：未找到 van den Akker (1999) 原文使用该句式；原文是 p. 9 的 "design intervention X ... characteristics A, B, C ... procedures K, L, M ... arguments P, Q, R"。相似句式出自 van Aken (2004, p. 227) 的"技术规则"：`"if you want to achieve Y in situation Z, then something like action X will help"`（经两份二手文献核对，非直接读 van Aken 原文）。
2. **Sandoval (2014) 的 "indicators（指标）"**：原文无此词（全文检索仅见 "indicated"）。报告中的指标清单属于操作性改写。
3. **M&R (2019) 是否列四项质量标准**：本次未在可访问的章节/预览中核实到；不要把四项标准归到 M&R 名下。若 ref-verifier 能拿到纸书，请核第 6 章是否引 Nieveen 的四项标准。
4. **M&R (2019) 第 7 章引文的纸书页码**：引文来自 Routledge 第 2 版电子版（O'Reilly 平台），已核对文字但未核对纸书页码；建议引用时标"第 7 章 'Implementation and spread' 节"，或由 ref-verifier 拿到纸书后补 p. 199/200。
5. **Easterday et al. (2014) 的"八项特征"**：核查到的是**六阶段**（focus, understand, define, conceive, build, test）与相应论述，未找到"八项特征"；请勿按"八项特征"写。
6. **中文核心期刊中 Sandoval 式"猜想地图 / 设计猜想 / 理论猜想 / 中介过程"的用例**：未找到可靠来源。已查维普/CNKI 相关检索与期刊官网，只有数学教学语境的"猜想地图"（非 Sandoval 概念）。若必须引中文用例，建议引中文版《教育设计研究（理论与案例）》（王其云等，2017）相应章节（需核对内页译法），或直接引英文原文。
7. **"设计要求 vs 设计主张/设计命题"作为一对标准中文术语的出处**：未找到。英文有 requirements / propositions 区分（M&R），但"设计要求 vs 设计原则"不是英文标准二分。
8. **Kali (2006) 的 "meta-principles" 中文译法**：未见稳定中译；建议"元原则（meta-principles）"。
9. **Bakker (2019) "Design principles in design research: A commentary" 的完整出版信息**：本次只核到 Utrecht University 研究门户的题录与摘要（2019-03-15），未核到所在书名/页码；在正文中可作"另见 Bakker (2019) 的评论"提及，但暂不放进 APA 参考文献表，待 ref-verifier 补全。
10. **中文期刊条目**：以下条目来自期刊官网/维普/CNKI 书目页与摘要页，**未通读全文**；用于证明术语在中文核心期刊中的实际使用，不用于转引具体观点：
    - 梁文鑫, 余胜泉. (2006). 基于设计的研究的过程与特征. *电化教育研究*, (7), 19–21.（"迭代流程"）
    - 杨南昌. (2007). 基于设计的研究：正在兴起的学习研究新范式. *中国电化教育*, (5), 6–10.（"设计原则"）
    - 王美. (2007). 基于设计的研究——以高中研究型课程"人·建筑与城市"为例. *开放教育研究, 13*(2), 82–88.（"五条设计原则"）
    - 张文兰, 刘俊生. (2007). 基于设计的研究——教育技术学研究的一种新范式. *电化教育研究*, (10), 13–17.
    - 郑旭东, 杨九民. (2009). 学习科学研究方法论创新的艰难之旅——安·布朗和阿伦·柯林斯的贡献及"基于设计的研究"的缘起、内涵与挑战. *开放教育研究*, (1), 54–59.
    - 单迎杰, 傅钢善. (2017). 国内外基于设计的研究应用案例述评. *电化教育研究*, (5), 13–19, 27.（"迭代过程"）
    - 曾嘉灵, 张鹏, 尚俊杰. (2022). 基于设计的研究与教育游戏设计应用. *中国电化教育*, (8), 32–40.（"教育游戏设计原则"）
    - 黄洛颖, 冯晓英, 郭璐文, 张汇坷. (2024). 智能时代学习设计创新：理念、着力点与关键技术. *开放教育研究, 30*(1), 55–64.（"设计要求"作为一般用语；非 EDR 术语）
    - 王其云, 祝智庭, 顾小清 (主编). (2017). *教育设计研究（理论与案例）*. 华东师范大学出版社.（Plomp & Nieveen 2013 Part A 中文版；目录第六章"教育设计研究中的形成性评价"）

> 结论（中文术语）：**"设计原则""迭代""形成性评价"可用**；**"设计要求"可作一般中文用语**，但作为 EDR 术语需给英文并定义；**"设计主张/设计命题""猜想地图""设计猜想/理论猜想""中介过程"没有可靠中文核心期刊用例**，一律中英并置 + 首次定义。

---

## G. 核查方法与复现线索

- **自动校验记录（2026-11-02）**：用脚本把本笔记中 32 条英文引文与源 PDF 提取文本逐条比对（归一化空白、引号与行末连字符后做子串匹配），结果 **32/32 命中**。初检有 4 条因 PDF 行末连字符（con-\njecture、struc-\ntures、discur-\nsive、instrumen-\ntation）未命中，修正比对脚本后通过；引文本身无误。脚本逻辑见本笔记 §G 说明，可按下列 PDF 复现。
- 原始 PDF 与提取文本暂存于 `work/edr_scratch/`（本次核查用的临时目录，交付前已清理；如需复核可重新下载）：
  - `akker1999.pdf` / `akker_ch1.txt` / `nieveen_ch10.txt`：van den Akker et al. (1999) 全书 PDF（含第 1 章 pp. 1–14、第 10 章 pp. 125–136）。来源：`https://andymatuschak.org/files/papers/van%20den%20Akker%20et%20al.%20-%201999%20-%20Design%20Approaches%20and%20Tools%20in%20Education%20and%20Train.pdf`
  - `sandoval.pdf` / `sandoval.txt`：Sandoval (2014) 作者版 PDF（pp. 18–36）。来源：`https://computationalliteracies.net/publications/sandoval-2014-conjecture/sandoval_2014_conjecture.pdf`
  - `mckreeve_ch5.pdf` / `mckreeve_ch5.txt`：McKenney & Reeves (2015) 章节预印本。来源：`https://research.ou.nl/ws/portalfiles/portal/940312/McKenneyReevesPreprint.pdf`
  - `mckreeve2_preview.pdf` / `mckreeve2_preview.txt`：M&R 第 2 版出版社前置目录（核对 Table 5.2 p. 130、Figure 3.3 p. 83、章页码）。来源：`https://api.pageplace.de/preview/DT0400.9781351601771_A37401489/preview-9781351601771_A37401489.pdf`
  - `plomp2013_partA.pdf` / `plomp2013_partA.txt`：Plomp & Nieveen (2013) Part A 全文（核对 pp. 24、28–29、Table 2）。来源：`https://www.slo.nl/publish/pages/4474/educational-design-research-part-a.pdf`
- 二手核对（用于交叉验证 van den Akker 引文页码与 van Aken 句式）：Cronholm & Göbel (2018) *Guidelines Supporting the Formulation of Design Principles*；Gregor, Chandra Kruse & Seidel, *Research Perspectives: The Anatomy of a Design Principle*（ANU open research repository）。
- 中文条目核对：维普期刊（cqvip）检索页、CNKI 期刊门户页、华东师大 pure 页、中国高校教材图书网（2017 中文版书讯）。
- 页码核对方式：PDF 页眉页脚（如 "24   EDUCATIONAL DESIGN RESEARCH - PART A: AN INTRODUCTION"）或 PDF 页码与书页偏移（van den Akker 书：PDF 页 − 8 = 书页；Sandoval：PDF 页 + 16 = 期刊页）。

---

## 附：给改稿人的最小行动清单（如果只看 5 件事）

1. §2 拆"约束性要求 / 设计决策"两张表，引 M&R 2015 + 2019 Table 5.2 p. 130。
2. §3 每条 DP 补"情境 / 目的"，改成 van den Akker 1999 p. 9 句式；证据标签改"类型 + 距离 + 边界"。
3. §4 六列改"高层猜想 / 体现（工具·任务·参与·话语）/ 中介过程 / 结果"，并加一行"设计猜想：要素→过程；理论猜想：过程→结果"；"指标"注明操作性改写。
4. §7 四项标准改引 Nieveen 1999 + Plomp 2013 pp. 28–29 + Nieveen & Folmer 2013；全节区分"预期/实际"。
5. §1、§7、§8 各加一句方法论锚点（通用模型阶段、四项标准层级、局部理论/中介证据），把报告从"产品说明"锚回"EDR 研究"。
