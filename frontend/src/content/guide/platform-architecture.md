---
title: 平台架构
summary: 这篇文章定义整个平台的蓝图，真正的核心对象，并如何落实更加智能的步伐
date: 2026-04-03
tags: 平台架构,迭代升级 , 智能数据平台
order: 1
section: guide
---

# 五个一级域
## Home 
面向“今天该做什么”。
放总览、待处理任务、最近抽取、异常提醒、推荐动作。
不是展示所有功能入口，而是展示平台当前状态。
## Pipeline
面向“文献进入系统以后怎么被处理”。
放上传、文献注册、抽取运行、Agent 过程、批处理队列、失败重试。
现在的 Workspace、AgentStatus、部分 Monitor 都应该归这里。
## Review
面向“人如何确认机器结果”。
放 Literature、Grounding、记录编辑、证据核对、置信度提升、问题回标。
这是你平台最有价值的核心层，应该成为独立主线。
## Knowledge
面向“数据如何沉淀为资产”。
放 Data Explorer、关系图谱、数据清洗、数据集构建、导出。
这里强调的是“可检索、可组合、可复用”，不是单纯查表。
## Modeling
面向“基于沉淀数据做预测和训练”。
放训练集选择、模型训练、评估、实验对比。
这是高级能力，不该和上传抽取并列。

Guide 和 Blog 不应该继续占据一级主导航，应该降到帮助中心或内容中心。
Monitor 也不该是主用户导航的一部分，应该是 Admin/Ops 入口。

# Key Objects
- Literature
- ExtractionRun
- Evidence
- Record
- Dataset
- Model
- Workspace/Scope