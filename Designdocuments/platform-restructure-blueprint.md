# IonicLink 平台重构蓝图

更新时间：2026-04-03

## 1. 文档目的

本文档用于重新定义 IonicLink 的平台骨架，解决当前系统在产品主线、模块边界、智能能力入口和实施优先级上的混乱问题。

目标不是继续堆叠功能，而是把平台整理成一个更有条理、更智能、更完善的研究工作台，并为后续前后端实施提供统一依据。

---

## 2. 当前判断

### 2.1 当前系统的真实状态

从现有仓库结构和代码组织看，IonicLink 已经不再只是一个“PDF 抽取工具”，而是在向研究工作台演化，已经具备：

- 文献上传与抽取
- 抽取运行追踪
- 证据定位与 PDF grounding
- 文献列表与记录探索
- 数据清洗
- 数据集构建
- 模型训练
- 运行监控
- 登录、角色、范围隔离

这说明系统的问题不是功能不足，而是平台结构落后于能力增长速度。

### 2.2 当前混乱的根因

#### 产品层

- 一级导航按功能堆叠，而不是按任务主线组织。
- `Guide`、`Workspace`、`Dashboard`、`Cleaning`、`Predict`、`Monitor`、`Literature`、`Grounding`、`Blog` 同时平级，用户难以形成稳定心智模型。
- 平台最重要的主线没有被明确强调，上传、审阅、知识沉淀、建模目前处于混杂状态。

#### 前端层

- [`frontend/src/App.vue`](D:\Julyanffzz\IonicLink\frontend\src\App.vue) 负责导航、页面壳层、视图切换和页面编排，职责过重。
- [`frontend/src/composables/useAppShell.ts`](D:\Julyanffzz\IonicLink\frontend\src\composables\useAppShell.ts) 同时承担认证、范围、批量文件、抽取轮询、聊天、grounding 等职责，已成为状态汇聚点。
- [`frontend/src/lib/api.ts`](D:\Julyanffzz\IonicLink\frontend\src\lib\api.ts) 已经演变成巨型 API 文件，不利于后续扩展和隔离。

#### 后端层

- router 数量已经不少，但领域边界还不够清晰。
- [`backend/routers/extraction.py`](D:\Julyanffzz\IonicLink\backend\routers\extraction.py) 同时包含上传、抽取、PDF、evidence 等多类职责。
- services 已经很多，但领域分组和编排层还不够明确。
- 平台对象存在，但还没有被完整显式化成产品和接口骨架。

### 2.3 当前阶段的关键结论

IonicLink 现在最需要的不是继续加功能，而是先完成一次平台级重构：

- 先重建信息架构
- 再重建核心对象模型
- 再重建前后端模块边界
- 最后把智能能力植入主流程

---

## 3. 平台重新定位

### 3.1 平台定义

IonicLink 应定义为：

**面向离子液体摩擦学文献的数据生产、证据审阅、知识沉淀与建模研究平台。**

### 3.2 平台主线

平台核心主线应统一为：

`文献进入系统 -> 自动抽取 -> 人工审阅 -> 结构化沉淀 -> 数据集构建 -> 模型训练与分析`

后续所有页面、接口、对象和智能能力，都应围绕这条主线组织。

### 3.3 平台目标

- 让用户清楚知道当前处于哪个工作阶段
- 让每个页面服务于明确的研究任务
- 让智能能力直接嵌入流程，而不是孤立成聊天或展示模块
- 让平台最终沉淀为可持续扩展的知识与模型基础设施

---

## 4. 目标信息架构

建议将平台一级域重构为 5 个主域。

### 4.1 Home

定位：平台首页，回答“现在最值得处理的是什么”。

承载内容：

- 今日待处理任务
- 最近抽取运行
- 审阅队列摘要
- 数据覆盖率摘要
- 异常与失败告警
- 推荐下一步动作

设计原则：

- 不作为功能目录页
- 不展示全部入口
- 强调状态、风险、建议动作

### 4.2 Pipeline

定位：文献进入系统后的自动处理流水线。

承载内容：

- 文献上传
- 文献注册与批处理
- 抽取运行状态
- Agent 执行过程
- 失败重跑
- 批量同步与导入

### 4.3 Review

定位：机器结果的人机协同审阅层。

承载内容：

- 文献列表
- 单篇文献记录审阅
- Source grounding
- 证据对照
- 字段编辑
- 低置信度记录优先处理
- 问题回标与确认

这是平台最有价值的核心层，应该成为独立主线。

### 4.4 Knowledge

定位：结构化数据和研究知识资产层。

承载内容：

- Data Explorer
- 关系图谱
- 过滤搜索
- 数据质量视图
- 数据清洗
- 数据集构建
- 导出

重点不是“查数据”，而是“形成可复用知识资产”。

### 4.5 Modeling

定位：基于沉淀数据的训练、预测与分析层。

承载内容：

- 训练集选择
- 特征准备
- 模型训练
- 评估结果
- 模型对比
- 实验追踪

这是高级能力层，不应再与上传、抽取、审阅平级混杂。

### 4.6 非主导航模块

以下内容不建议继续占据一级主导航：

- `Guide`
- `Blog`
- `Monitor`

建议处理方式：

- `Guide` -> Help / 上手中心
- `Blog` -> Content / 内容中心
- `Monitor` -> Admin / Ops 专区

---

## 5. 推荐页面树

建议页面树如下：

```text
Home
Pipeline
Review
Knowledge
Modeling
Admin
Help
```

建议二级结构如下：

```text
Home
  - Today
  - Alerts
  - Suggested Actions

Pipeline
  - Upload Queue
  - Extraction Runs
  - Batch Center
  - Run Detail

Review
  - Literature Inbox
  - Record Review
  - Grounding Viewer
  - Review Queue

Knowledge
  - Explorer
  - Relationship Graph
  - Cleaning Studio
  - Dataset Builder
  - Exports

Modeling
  - Training Runs
  - Evaluation
  - Model Registry

Admin
  - Runtime Monitor
  - User And Scope
  - Usage Metrics

Help
  - Quick Start
  - Workflow Guide
  - Content Center
```

---

## 6. 页面归属调整

下面是当前主要前端页面向目标信息架构的归属建议。

### 6.1 保留但重新归类

- `Dashboard` -> `Home`
- `LiteratureList` -> `Review`
- `SourceGroundingView` -> `Review`
- `IntegratedExplorer` -> `Knowledge`
- `DataCleaningWorkbench` -> `Knowledge`
- `ModelTrainingWorkbench` -> `Modeling`
- `MonitorView` -> `Admin`
- `GettingStarted` -> `Help`
- `BlogView` -> `Help` 或 `Content`

### 6.2 拆解或降级

- `Workspace` 不应继续作为超级页面存在，应拆解进入 `Pipeline`、`Review`、`Knowledge`
- `Guide` 不应作为一级主线，应转为说明和帮助内容
- `Monitor` 不应对普通用户长期暴露为主导航

### 6.3 当前组件迁移映射

- `FileUpload` -> `Pipeline / Upload Queue`
- `AgentStatusPanel` -> `Pipeline / Extraction Runs`
- `ChatPanel` -> 不再作为独立主线，应降为页面侧边协助能力
- `InteractiveEvidencePanel` -> `Review / Record Review`
- `RelationshipGraphPanel` -> `Knowledge / Relationship Graph`
- `BatchDataPreview`、`DataPreview` -> `Pipeline` 或 `Review` 的上下文组件，不再独立承载平台入口意义

---

## 7. 核心对象模型

后续前后端重构应围绕核心对象展开，而不是围绕页面名称展开。

### 7.1 核心对象

- `WorkspaceScope`
- `Literature`
- `ExtractionRun`
- `Evidence`
- `Record`
- `Dataset`
- `Model`

### 7.2 对象职责

#### WorkspaceScope

定义当前用户工作的边界，包括组、课题、数据范围和权限。

#### Literature

平台的输入对象。每篇文献是一个独立工作单元，承载 PDF、元数据、抽取状态和审阅状态。

#### ExtractionRun

平台的运行对象。记录一次抽取任务的配置、阶段、日志、候选、结果和错误信息。

#### Evidence

平台的可追溯对象。任何结构化记录都应尽量能回溯到 PDF 页码、文本片段、图表区域或图像裁剪。

#### Record

平台的知识原子。每条摩擦学记录是知识沉淀的最小结构单元，应支持标准化、修订、评分和聚合。

#### Dataset

平台的建模输入对象。它不是简单导出文件，而是一个可定义、可重建、可追踪的数据集。

#### Model

平台的分析输出对象。包括训练配置、模型版本、评估指标和适用范围。

### 7.3 生命周期主链

```text
Literature
  -> ExtractionRun
  -> Candidate / Evidence
  -> Reviewed Record
  -> Knowledge Base
  -> Dataset
  -> Model
```

### 7.4 推荐状态字段

为减少系统状态混乱，建议尽量统一以下状态轴：

- `Literature.status`: uploaded / queued / extracting / review_needed / reviewed / archived
- `ExtractionRun.status`: queued / running / completed / failed / cancelled
- `Record.review_status`: pending / accepted / corrected / rejected
- `Dataset.status`: draft / ready / frozen / exported
- `Model.status`: draft / training / evaluated / published / deprecated

---

## 8. 智能能力重构原则

“更智能”不应等价于“多一个聊天框”。

平台的智能化应优先体现在以下四层。

### 8.1 流程智能

系统主动判断：

- 哪些文献应优先处理
- 哪些抽取运行失败需要重试
- 哪些批次阻塞了后续任务
- 哪些 scope 当前产出不足

输出形式：

- 首页推荐动作
- Pipeline 队列排序
- 异常告警

### 8.2 审阅智能

系统主动帮助人工审阅：

- 按低置信度排序
- 自动标出缺字段记录
- 自动标出 evidence 不完整记录
- 自动标出字段冲突和可疑值
- 自动聚合相似记录供人工确认

输出形式：

- Review Queue
- Smart Flags
- Suggested Fixes

### 8.3 知识智能

系统主动提升记录质量：

- IL 名称归一化
- 化学实体映射
- 单位与字段标准化
- 条件字段补齐
- 重复记录聚合
- 数据集覆盖率诊断

输出形式：

- 标准化建议
- 记录聚类结果
- 数据质量面板

### 8.4 运营智能

系统应提供平台级可观测性：

- 抽取成功率
- evidence 完整率
- 审阅完成率
- 记录覆盖率
- 数据集可用率
- 模型训练数据缺口

输出形式：

- Home 摘要卡片
- Admin 监控面板
- 质量健康报告

---

## 9. 前端重构目标

### 9.1 壳层职责收缩

[`frontend/src/App.vue`](D:\Julyanffzz\IonicLink\frontend\src\App.vue) 应收缩为：

- 全局布局
- 一级导航
- 会话边界
- 权限边界
- 路由出口

不再承担：

- 业务视图编排
- 大量 `currentView` 分支逻辑
- 复杂页面状态拼装

### 9.2 路由化

建议引入正式页面路由，而不是继续手写顶层视图切换。

建议页面组织：

- `pages/home`
- `pages/pipeline`
- `pages/review`
- `pages/knowledge`
- `pages/modeling`
- `pages/admin`
- `pages/help`

### 9.3 API 模块化

[`frontend/src/lib/api.ts`](D:\Julyanffzz\IonicLink\frontend\src\lib\api.ts) 应拆分为：

- `api/http.ts`
- `api/auth.ts`
- `api/pipeline.ts`
- `api/review.ts`
- `api/knowledge.ts`
- `api/modeling.ts`
- `api/admin.ts`

### 9.4 状态拆分

[`frontend/src/composables/useAppShell.ts`](D:\Julyanffzz\IonicLink\frontend\src\composables\useAppShell.ts) 应拆分为：

- `useAuthSession`
- `useWorkspaceScope`
- `usePipelineRuns`
- `useReviewGrounding`
- `useReviewQueue`
- `useKnowledgeFilters`
- `useModelWorkbench`

### 9.5 内容系统同步

前端 `src/content` 中的平台文档应与设计文档同步，确保：

- 外部说明和内部设计不出现两套叙事
- 帮助中心能够反映当前平台主线
- 后续平台迭代可通过内容系统持续沉淀

---

## 10. 后端重构目标

### 10.1 Router 领域重组

建议将 router 按平台领域重组：

- `routers/auth.py`
- `routers/pipeline.py`
- `routers/review.py`
- `routers/knowledge.py`
- `routers/modeling.py`
- `routers/admin.py`

### 10.2 Extraction 相关职责拆分

[`backend/routers/extraction.py`](D:\Julyanffzz\IonicLink\backend\routers\extraction.py) 当前职责过多，建议拆分为：

- `pipeline`: 上传、抽取、运行状态、重试
- `review`: PDF、highlights、evidence
- `knowledge`: 同步后的结构化访问入口

### 10.3 Service 分层

建议形成清晰分层：

- `domain services`
- `workflow services`
- `infrastructure services`

建议示意：

- `domain`: record normalization, evidence resolution, confidence scoring
- `workflow`: extraction orchestration, review queue generation, dataset build orchestration
- `infrastructure`: file IO, PDF rendering, LLM provider, database persistence

### 10.4 DTO 稳定化

后端对前端输出应从“功能返回”转向“对象返回”。

优先稳定以下 DTO：

- `LiteratureSummary`
- `LiteratureDetail`
- `ExtractionRunSummary`
- `ExtractionRunDetail`
- `ReviewRecord`
- `EvidencePayload`
- `DatasetSummary`
- `ModelRunSummary`

---

## 11. 接口域划分建议

为了让前后端边界一致，建议接口按领域重组。

### 11.1 Pipeline API

- 上传文件
- 创建抽取任务
- 查询运行列表
- 查询运行详情
- 取消运行
- 重试运行

### 11.2 Review API

- 查询待审文献
- 查询文献审阅详情
- 查询 record evidence
- 提交记录修正
- 提交审阅结论
- 查询 review queue

### 11.3 Knowledge API

- 搜索记录
- 查询图谱
- 查询统计概览
- 运行数据清洗
- 构建数据集
- 导出数据

### 11.4 Modeling API

- 创建训练任务
- 查询训练任务
- 查询评估结果
- 发布模型

### 11.5 Admin API

- 用户和范围管理
- 运行时监控
- usage metrics
- 平台健康检查

---

## 12. 分阶段实施路线图

### Phase 1：平台骨架重建

目标：先把平台信息架构和边界立住。

任务：

- 确定一级导航和页面树
- 把 `Guide`、`Blog`、`Monitor` 从主导航降级
- 明确核心对象命名
- 梳理现有页面归属
- 输出统一术语表

交付：

- 产品信息架构
- 页面归属表
- 模块命名规范

### Phase 2：前端壳层拆分

目标：把主壳层和状态中心解耦。

任务：

- 引入正式路由
- 缩减 `App.vue`
- 拆分 `useAppShell`
- 拆分 `api.ts`
- 将现有组件按页面域归档

交付：

- 新壳层结构
- 新 API 目录
- 新状态模块

### Phase 3：后端领域拆分

目标：让 API 结构和平台对象对齐。

任务：

- 重组 routers
- 抽离 extraction 中的 review 职责
- 抽离 workflow service
- 稳定关键 DTO

交付：

- 新 router 分组
- 新 service 分层
- 关键对象输出契约

### Phase 4：智能能力植入

目标：把“智能”变成平台默认能力。

任务：

- 建立 Review Queue
- 建立 Suggested Actions
- 建立数据质量评分
- 建立失败运行诊断
- 建立知识补全与标准化建议

交付：

- 首页智能摘要
- 审阅优先级系统
- 数据质量和运营指标面板

---

## 13. 当前最值得先做的 12 件事

1. 冻结一级导航，不再继续增加新的平级入口。
2. 把 `Workspace` 从超级容器页面拆解为明确领域页面。
3. 把 `Guide`、`Blog`、`Monitor` 降级为非主导航模块。
4. 统一平台核心对象命名：`Literature / ExtractionRun / Evidence / Record / Dataset / Model`。
5. 输出页面归属表，避免继续按组件直觉扩展平台结构。
6. 拆分前端 `api.ts`，停止继续向单文件追加接口。
7. 拆分 `useAppShell.ts`，停止继续向壳层状态聚合。
8. 拆分 extraction router，停止把所有能力都挂在一个域下。
9. 为 Review 单独建立“审阅队列”产品层概念。
10. 为 Home 建立“推荐下一步动作”机制。
11. 为 Knowledge 层建立“数据质量与覆盖率”统一视图。
12. 为平台帮助中心同步更新当前主线叙事，避免产品和文档脱节。

---

## 14. 暂不建议优先做的事

在完成平台骨架重构前，不建议继续优先做以下事项：

- 继续增加新的一级页面
- 再做一个新的聊天面板
- 把更多功能继续塞进 Workspace
- 在没有对象模型的情况下继续扩展 API
- 在没有审阅队列的情况下继续强化零散编辑能力

这些动作会继续增加复杂度，但不会显著提升平台秩序。

---

## 15. 成功标准

平台重构完成后，应该达到以下结果：

- 用户能明确知道自己当前处于哪个工作阶段
- 每个一级导航都对应一个稳定的任务域
- 任何核心页面都能明确说明自己服务哪个核心对象
- 智能能力体现在流程推进和质量提升上，而不只是对话入口
- 前后端模块结构能够稳定支持后续扩展
- 内容系统中的平台说明与实际实现方向一致

---

## 16. 一句话总结

IonicLink 下一阶段的重点，不是继续做更多功能，而是把现有能力重组为一个以 `Pipeline -> Review -> Knowledge -> Modeling` 为主线的智能研究平台。
