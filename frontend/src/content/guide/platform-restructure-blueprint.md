---
title: 平台重构蓝图
summary: 这份文档重新定义 IonicLink 的平台主线、信息架构、核心对象和实施路线，用来把系统从功能堆叠整理为清晰的智能研究平台。
date: 2026-04-03
tags: 平台重构, 信息架构, 智能平台
order: 2
section: guide
---

# IonicLink 平台重构蓝图

## 为什么现在必须重构平台骨架

IonicLink 现在已经不再只是一个 PDF 抽取工具，而是在向研究工作台演化。它已经同时包含上传、抽取、证据定位、文献审阅、数据探索、数据清洗、数据集构建、模型训练和运行监控。

问题不是功能不够，而是功能增长之后，平台结构还停留在堆叠阶段。页面入口越来越多，模块职责越来越重，用户很难形成稳定的任务心智，开发也越来越难保持边界清晰。

所以当前最重要的任务，不是继续加功能，而是先把平台整理成一个更有条理的骨架。

## 当前混乱主要来自哪里

当前平台的混乱主要来自三个层面。

### 产品层

- 一级导航按功能堆叠，而不是按任务主线组织
- `Guide`、`Workspace`、`Dashboard`、`Cleaning`、`Predict`、`Monitor`、`Literature`、`Grounding`、`Blog` 同时平级
- 上传、审阅、知识沉淀、建模现在处于混杂状态

### 前端层

- `App.vue` 同时承担导航、壳层、视图切换和页面编排
- `useAppShell.ts` 同时承担认证、范围、批量文件、抽取轮询、聊天和 grounding
- `api.ts` 已经演变成巨型接口文件

### 后端层

- router 已经很多，但领域边界仍不稳定
- extraction 路由下同时放了上传、抽取、PDF、evidence 等多类职责
- services 虽多，但还没有形成足够清晰的领域分层

## 新的平台定义

IonicLink 应该被定义为：

**面向离子液体摩擦学文献的数据生产、证据审阅、知识沉淀与建模研究平台。**

平台之后的所有页面、接口、对象和智能能力，都应围绕同一条主线组织：

`文献进入系统 -> 自动抽取 -> 人工审阅 -> 结构化沉淀 -> 数据集构建 -> 模型训练与分析`

## 新的信息架构

建议把平台一级域收敛为 5 个主域。

### Home

回答“现在最值得处理的是什么”。

- 今日待处理任务
- 最近抽取运行
- 审阅队列摘要
- 数据覆盖率摘要
- 异常告警
- 推荐下一步动作

### Pipeline

回答“文献进入系统后怎么被处理”。

- 文献上传
- 文献注册与批处理
- 抽取运行状态
- Agent 执行过程
- 失败重跑
- 批量同步与导入

### Review

回答“机器结果如何被人确认”。

- 文献列表
- 单篇文献记录审阅
- Source grounding
- 证据对照
- 字段编辑
- 低置信度记录优先处理
- 问题回标与确认

这是平台最有价值的核心层，应该成为独立主线。

### Knowledge

回答“数据如何沉淀为资产”。

- Data Explorer
- 关系图谱
- 过滤搜索
- 数据质量视图
- 数据清洗
- 数据集构建
- 导出

### Modeling

回答“如何基于沉淀数据训练和分析”。

- 训练集选择
- 特征准备
- 模型训练
- 评估结果
- 模型对比
- 实验追踪

## 哪些内容不该再做一级导航

以下内容不建议继续占据一级主导航。

- `Guide`
- `Blog`
- `Monitor`

建议处理方式：

- `Guide` 进入帮助中心
- `Blog` 进入内容中心
- `Monitor` 进入 Admin 或 Ops 专区

## 推荐页面树

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

## 现有页面应该怎么归类

### 保留但重新归类

- `Dashboard` -> `Home`
- `LiteratureList` -> `Review`
- `SourceGroundingView` -> `Review`
- `IntegratedExplorer` -> `Knowledge`
- `DataCleaningWorkbench` -> `Knowledge`
- `ModelTrainingWorkbench` -> `Modeling`
- `MonitorView` -> `Admin`
- `GettingStarted` -> `Help`
- `BlogView` -> `Help` 或 `Content`

### 必须拆解或降级

- `Workspace` 不应继续作为超级页面存在
- `Guide` 不应继续作为一级主线
- `Monitor` 不应继续作为普通用户主入口

### 组件迁移建议

- `FileUpload` -> `Pipeline`
- `AgentStatusPanel` -> `Pipeline`
- `ChatPanel` -> 降为页面侧边协助能力
- `InteractiveEvidencePanel` -> `Review`
- `RelationshipGraphPanel` -> `Knowledge`

## 平台真正的核心对象

后续前后端重构应该围绕核心对象展开，而不是围绕页面名展开。

- `WorkspaceScope`
- `Literature`
- `ExtractionRun`
- `Evidence`
- `Record`
- `Dataset`
- `Model`

推荐主链如下：

```text
Literature
  -> ExtractionRun
  -> Candidate / Evidence
  -> Reviewed Record
  -> Knowledge Base
  -> Dataset
  -> Model
```

推荐统一以下状态轴：

- `Literature.status`: uploaded / queued / extracting / review_needed / reviewed / archived
- `ExtractionRun.status`: queued / running / completed / failed / cancelled
- `Record.review_status`: pending / accepted / corrected / rejected
- `Dataset.status`: draft / ready / frozen / exported
- `Model.status`: draft / training / evaluated / published / deprecated

## 更智能应该体现在什么地方

“更智能”不应等价于“多一个聊天框”，而应优先体现在四层能力。

### 流程智能

- 告诉用户哪些文献要优先处理
- 告诉用户哪些运行失败需要重试
- 告诉用户哪些批次阻塞了后续任务
- 告诉用户哪个 scope 当前产出不足

### 审阅智能

- 按低置信度排序
- 自动标出缺字段记录
- 自动标出 evidence 不完整记录
- 自动标出字段冲突和可疑值
- 自动聚合相似记录供人工确认

### 知识智能

- IL 名称归一化
- 化学实体映射
- 单位标准化
- 条件字段补齐
- 重复记录聚合
- 数据集覆盖率诊断

### 运营智能

- 抽取成功率
- evidence 完整率
- 审阅完成率
- 记录覆盖率
- 数据集可用率
- 模型训练数据缺口

## 前端重构目标

### 壳层收缩

`App.vue` 只负责：

- 全局布局
- 一级导航
- 会话边界
- 权限边界
- 路由出口

不再负责大规模业务视图编排。

### 路由化

建议页面目录变为：

- `pages/home`
- `pages/pipeline`
- `pages/review`
- `pages/knowledge`
- `pages/modeling`
- `pages/admin`
- `pages/help`

### API 模块化

建议把巨型 `api.ts` 拆分为：

- `api/http.ts`
- `api/auth.ts`
- `api/pipeline.ts`
- `api/review.ts`
- `api/knowledge.ts`
- `api/modeling.ts`
- `api/admin.ts`

### 状态拆分

建议把 `useAppShell.ts` 拆分为：

- `useAuthSession`
- `useWorkspaceScope`
- `usePipelineRuns`
- `useReviewGrounding`
- `useReviewQueue`
- `useKnowledgeFilters`
- `useModelWorkbench`

## 后端重构目标

建议将 router 按领域重组为：

- `routers/auth.py`
- `routers/pipeline.py`
- `routers/review.py`
- `routers/knowledge.py`
- `routers/modeling.py`
- `routers/admin.py`

其中 extraction 相关职责应拆为：

- `pipeline`: 上传、抽取、运行状态、重试
- `review`: PDF、highlights、evidence
- `knowledge`: 同步后的结构化访问入口

建议优先稳定以下对象输出：

- `LiteratureSummary`
- `LiteratureDetail`
- `ExtractionRunSummary`
- `ExtractionRunDetail`
- `ReviewRecord`
- `EvidencePayload`
- `DatasetSummary`
- `ModelRunSummary`

## 接口域划分建议

### Pipeline API

- 上传文件
- 创建抽取任务
- 查询运行列表
- 查询运行详情
- 取消运行
- 重试运行

### Review API

- 查询待审文献
- 查询文献审阅详情
- 查询 record evidence
- 提交记录修正
- 提交审阅结论
- 查询 review queue

### Knowledge API

- 搜索记录
- 查询图谱
- 查询统计概览
- 运行数据清洗
- 构建数据集
- 导出数据

### Modeling API

- 创建训练任务
- 查询训练任务
- 查询评估结果
- 发布模型

### Admin API

- 用户和范围管理
- 运行时监控
- usage metrics
- 平台健康检查

## 分阶段实施路线图

### Phase 1：平台骨架重建

- 确定一级导航和页面树
- 把 `Guide`、`Blog`、`Monitor` 从主导航降级
- 明确核心对象命名
- 梳理现有页面归属
- 输出统一术语表

### Phase 2：前端壳层拆分

- 引入正式路由
- 缩减 `App.vue`
- 拆分 `useAppShell`
- 拆分 `api.ts`
- 将现有组件按页面域归档

### Phase 3：后端领域拆分

- 重组 routers
- 抽离 extraction 中的 review 职责
- 抽离 workflow service
- 稳定关键 DTO

### Phase 4：智能能力植入

- 建立 Review Queue
- 建立 Suggested Actions
- 建立数据质量评分
- 建立失败运行诊断
- 建立知识补全与标准化建议

## 当前最值得先做的事

1. 冻结一级导航，不再继续增加新的平级入口。
2. 把 `Workspace` 拆解为明确领域页面。
3. 让 `Guide`、`Blog`、`Monitor` 退出主导航。
4. 统一平台核心对象命名。
5. 输出页面归属表，避免继续按组件直觉扩展。
6. 拆分前端 `api.ts`。
7. 拆分 `useAppShell.ts`。
8. 拆分 extraction router。
9. 为 Review 建立审阅队列。
10. 为 Home 建立推荐下一步动作。
11. 为 Knowledge 建立统一的数据质量视图。
12. 让帮助中心中的平台说明和实际实现方向始终同步。

## 一句话总结

IonicLink 下一阶段的重点，不是继续做更多功能，而是把现有能力重组为一个以 `Pipeline -> Review -> Knowledge -> Modeling` 为主线的智能研究平台。
