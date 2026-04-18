# IonicLink 论文架构图提示词文档

更新时间：2026-04-04

## 1. 文档目的

本文档用于为 IonicLink 平台生成适合毕业论文、开题报告、答辩 PPT 和技术论文中的“平台架构图”提示词。

适用场景：

- 用 AI 制图工具生成论文插图
- 用图示工具生成结构草图
- 用文本生成 Mermaid、draw.io 草图、流程图草案
- 统一论文中关于 IonicLink 的系统表达方式

---

## 2. IonicLink 平台的论文表达定位

在论文中，IonicLink 不应被描述为一个普通网页系统，而应被表达为：

**一个面向离子液体摩擦学文献的数据抽取、证据溯源、人工审阅、知识沉淀与建模分析的一体化研究平台。**

因此架构图的核心逻辑不是：

`前端 -> 后端 -> 数据库`

而应强调：

`文献输入 -> 抽取流水线 -> Evidence 层 -> Review 审阅 -> Knowledge 沉淀 -> Modeling 分析`

---

## 3. 论文架构图建议包含的核心模块

无论采用哪种画法，建议图中尽量包含以下核心模块。

### 输入层

- PDF 文献
- 文本内容
- 批量导入

### 流水线层

- 文献上传与注册
- 文档解析
- LLM 抽取
- 候选记录生成
- 运行监控

### Evidence 层

- 正文证据
- 图注证据
- 图例证据
- 表格证据
- 样品编号映射

### Review 层

- 文献 Inbox
- Record Candidate 审阅
- 字段级 grounding
- 人工确认与纠错

### Knowledge 层

- 结构化记录库
- 检索与筛选
- 关系图谱
- 数据清洗
- 数据集构建

### Modeling 层

- 特征构建
- 模型训练
- 模型评估
- 模型登记

### 支撑层

- 前端交互界面
- FastAPI 后端服务
- SQLite / 数据库存储
- 日志与运行监控

---

## 4. 论文插图的视觉要求

用于论文的架构图建议遵循以下风格约束：

- 学术风格，简洁、清晰、理性
- 白色背景
- 蓝灰色、深蓝色、浅金色点缀
- 扁平化、非卡通
- 模块之间层级清楚
- 标注简洁，不使用大段句子
- 适合放在论文正文或答辩 PPT 中
- 避免网页截图感
- 避免商业产品宣传海报风格

建议关键词：

- academic system architecture diagram
- clean, minimal, publication-ready
- white background
- blue-gray palette
- vector style
- modular layout
- clear hierarchy

---

## 5. 主提示词：论文总架构图

下面这个提示词适合生成“论文总架构图”。

## 5.1 中文版主提示词

```text
请生成一张适合材料学院本科毕业论文使用的系统架构图，主题为“IonicLink：面向离子液体摩擦学文献的智能数据抽取与知识管理平台”。

图中采用自左向右或自上而下的学术型模块布局，整体风格简洁、理性、适合论文插图，白色背景，蓝灰色主色，少量浅金色强调，矢量化、扁平化、非商业海报风格。

图中应包含以下层次与模块：

1. 输入层：
- PDF literature
- text content
- batch import

2. Pipeline 层：
- upload and registration
- document parsing
- LLM extraction
- candidate generation
- run monitoring

3. Evidence 层：
- text evidence
- caption evidence
- legend evidence
- table evidence
- sample ID mapping

4. Review 层：
- literature inbox
- record candidate review
- field-level grounding
- human confirmation and correction

5. Knowledge 层：
- structured records
- search and filtering
- relationship graph
- data cleaning
- dataset builder

6. Modeling 层：
- feature construction
- model training
- evaluation
- model registry

7. System support layer：
- Vue frontend
- FastAPI backend
- SQLite database
- logging and runtime monitor

要求：
- 明确展示“文献输入 -> 抽取 -> evidence -> review -> knowledge -> modeling”的主流程
- 强调 Review 是平台可信性的核心环节
- 强调 Evidence-first 的研究逻辑
- 图中文字简洁专业，适合论文图注
- 整体布局平衡，箭头关系清楚
- 输出效果应像论文中的Figure，不要像网页界面截图
```

## 5.2 英文版主提示词

```text
Create a publication-ready academic system architecture diagram for a materials science undergraduate thesis. The title is “IonicLink: An intelligent platform for literature extraction, evidence grounding, knowledge management, and modeling in ionic liquid tribology”.

Use a clean academic style with white background, blue-gray color palette, subtle light gold highlights, flat vector graphics, and a balanced modular layout. The figure should look like a thesis system architecture diagram, not a web UI screenshot or a marketing poster.

The diagram should include these layers:

1. Input layer:
- PDF literature
- text content
- batch import

2. Pipeline layer:
- upload and registration
- document parsing
- LLM extraction
- candidate generation
- run monitoring

3. Evidence layer:
- text evidence
- caption evidence
- legend evidence
- table evidence
- sample ID mapping

4. Review layer:
- literature inbox
- record candidate review
- field-level grounding
- human confirmation and correction

5. Knowledge layer:
- structured records
- search and filtering
- relationship graph
- data cleaning
- dataset builder

6. Modeling layer:
- feature construction
- model training
- evaluation
- model registry

7. System support layer:
- Vue frontend
- FastAPI backend
- SQLite database
- logging and runtime monitoring

Show the core workflow clearly:
literature input -> extraction pipeline -> evidence layer -> review -> knowledge -> modeling.

Emphasize that review is the trust-building core of the platform and that the system follows an evidence-first logic.

The typography should be concise, professional, and suitable for a thesis figure.
```

---

## 6. 变体提示词

为了适应论文不同章节，建议准备几种不同用途的架构图提示词。

## 6.1 变体 A：系统总体架构图

适用章节：

- 第3章 系统总体设计
- 第4章 平台设计与实现

```text
请生成一张 IonicLink 平台总体架构图，重点表现前端、后端、数据库与业务模块之间的关系。图中以分层结构展示：

- Presentation Layer: Vue frontend, review interface, knowledge interface
- Service Layer: pipeline service, review service, knowledge service, modeling service
- Data Layer: literature, extraction runs, candidates, final records, datasets
- Support Layer: logging, monitoring, authentication

要求风格为学术论文插图风格，简洁、规范、白底、蓝灰配色、适合毕业论文正文。
```

## 6.2 变体 B：Evidence-First 抽取流程图

适用章节：

- 第5章 数据处理流程
- 第6章 抽取方法说明

```text
请生成一张 Evidence-first 文献抽取流程图，用于展示 IonicLink 如何从 PDF 文献中提取可靠数据。

图中流程包括：
- literature input
- document parsing
- evidence fact extraction
- sample/context linking
- field candidate assembly
- record candidate generation
- review and grounding
- final structured record
- observation separation

要求突出：
- 先 evidence，后 record
- 趋势性 observation 与定量 record 分流
- review 是 final record 的前置条件

风格为学术流程图，论文可用，白底，蓝灰色，逻辑箭头清晰。
```

## 6.3 变体 C：Review 架构图

适用章节：

- 第4章 Review 模块设计
- 第6章 evidence grounding 分析

```text
请生成一张 IonicLink Review 模块架构图，重点展示“文献 -> record candidate -> 字段 -> evidence grounding”的审阅逻辑。

图中应包含：
- Literature Inbox
- Record Rail
- Field Review Panel
- Evidence Inspector
- Human Confirmation
- Promotion to Final Record

同时标出每个字段的 evidence 可能来自：
- text
- caption
- legend
- figure
- table
- inferred

要求图中突出：
- 字段级 provenance
- 缺证据不可确认
- Review 是构建可信数据的核心环节

风格应简洁、学术、清晰，适合论文插图。
```

## 6.4 变体 D：平台研究流程图

适用章节：

- 绪论
- 开题报告
- 答辩总览页

```text
请生成一张 IonicLink 平台研究流程图，用于说明本研究如何将离子液体摩擦学文献转化为可分析数据资产。

流程为：
- materials research problem
- literature collection
- document extraction
- evidence grounding
- review and correction
- structured knowledge base
- dataset construction
- model analysis
- research conclusions

要求表达“材料问题驱动的数据平台研究”，而不是普通软件开发流程。风格要求学术化、白底、矢量图、蓝灰色、适合答辩 PPT 和论文。
```

---

## 7. 反向约束提示词

如果你使用的 AI 制图工具支持负面约束，可以补充以下内容：

```text
不要生成网页界面截图风格
不要生成过于复杂的 3D 图形
不要生成商业海报风格
不要使用过度鲜艳的霓虹色
不要出现卡通风格图标
不要堆叠过多装饰性元素
不要让文字过长难以阅读
```

---

## 8. 论文图注建议

生成架构图之后，论文中可以配套使用以下图注。

## 8.1 总体架构图图注

```text
图 X.X IonicLink 平台总体架构图
```

## 8.2 Evidence-first 流程图图注

```text
图 X.X IonicLink 平台基于 evidence-first 的文献数据抽取流程
```

## 8.3 Review 架构图图注

```text
图 X.X IonicLink 平台 Review 模块与字段级 evidence grounding 机制
```

---

## 9. 推荐的图中标题写法

如果图内需要写标题，建议使用以下风格：

- `IonicLink Platform Architecture`
- `Evidence-First Extraction Workflow`
- `Review and Grounding Architecture`
- `System Architecture of IonicLink`
- `Research Data Pipeline for Ionic Liquid Tribology Literature`

---

## 10. 最推荐的一条最终提示词

如果你只想先用一条提示词生成初稿，优先使用这一条。

```text
请生成一张适合材料学院本科毕业论文的学术型平台架构图，主题为“IonicLink：面向离子液体摩擦学文献的智能数据抽取与知识管理平台”。图中采用白色背景、蓝灰色主色、扁平矢量风格、模块化布局，整体效果像论文中的 Figure，而不是网页截图。

图中要清晰表现以下主线：
文献输入 -> 文档解析与LLM抽取 -> Evidence层 -> Review审阅与grounding -> 结构化知识库 -> 数据集构建 -> 模型训练与分析。

图中包含模块：
PDF literature、batch import、upload and registration、document parsing、LLM extraction、candidate generation、text evidence、caption evidence、legend evidence、table evidence、sample ID mapping、literature inbox、record candidate review、field-level grounding、human confirmation、structured records、search and filtering、relationship graph、data cleaning、dataset builder、feature construction、model training、evaluation、model registry、Vue frontend、FastAPI backend、SQLite database、logging and runtime monitor。

要求突出：
1. Evidence-first
2. Review 是可信数据形成的核心
3. 平台不是普通网页，而是研究数据工作台
4. 图面干净、专业、适合论文排版
```

---

## 11. 一句话总结

IonicLink 的论文架构图提示词，核心不是让 AI 画一个软件系统，而是让它画出“文献如何通过 evidence、review 和 knowledge 流程转化为可信研究数据资产”的平台逻辑。
