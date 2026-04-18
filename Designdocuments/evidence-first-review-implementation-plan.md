# IonicLink Evidence-First 抽取与 Review 重构实施文档

更新时间：2026-04-04

## 1. 文档目的

本文档用于指导 IonicLink 从当前的 `record-first` 抽取架构，升级为 `evidence-first` 抽取与审阅架构。

目标是解决以下核心问题：

- 错误 record 一旦生成，后续 evidence grounding 无法修复
- record 级 evidence 过粗，无法支持字段级溯源
- 趋势描述、图注说明、样品编码、定量记录混杂，导致跨上下文拼接错误
- Review 界面在审“模型拼好的结果”，而不是审“字段对应的证据”

---

## 2. 触发本次重构的典型案例

### 2.1 典型文献

`Controlling the nanoscale friction by layered ionic liquid films`

### 2.2 当前暴露出的错误

基于该文献的当前抽取结果，已经出现以下结构性问题：

- 不同上下文中的 `material`、`ionic_liquid`、`cof` 被拼成同一条 record
- 趋势性结论被直接当作结构化实验记录写入
- 一些数值虽然存在，但与样品编号、panel、caption 没有被稳定绑定
- UI 中虽然展示了 evidence grounding，但 grounding 实际上只是 record 级摘要，而不是字段级证据链

### 2.3 问题的本质

当前系统默认采用：

`先生成 record -> 再附加 evidence -> 再做 grounding`

但该类文献更适合：

`先抽 evidence fact -> 再组装 field -> 再组装 record -> 最后进入 review`

一旦最终 record 在第一步就拼错，后面的 grounding 只会围绕错误结果继续工作，无法真正清洗和溯源。

---

## 3. 当前架构的关键限制

### 3.1 数据模型限制

当前 [`backend/models/tribology.py`](D:\Julyanffzz\IonicLink\backend\models\tribology.py) 中的 `TribologyData` 只有 record 级 provenance：

- `evidence`
- `source`
- `source_page`
- `source_figure`

这会导致系统只能回答：

- “这条 record 大概来自哪里”

但无法回答：

- `material` 来自哪一句
- `cof` 来自哪个 panel 或 legend
- `ionic_liquid` 是否与 `cof` 来自同一个 sample trace

### 3.2 抽取链路限制

当前核心合并逻辑集中在：

- [`backend/services/file_service.py`](D:\Julyanffzz\IonicLink\backend\services\file_service.py)
- [`backend/services/llm/deduplication.py`](D:\Julyanffzz\IonicLink\backend\services\llm\deduplication.py)

现有机制的特点是：

- 先让模型直接产出近似最终态 record
- 再做去重和合并
- 再尝试给 record 绑定 evidence 坐标

这对“表格型、字段齐全、单行即单记录”的论文有效，但对以下文献类型风险很高：

- figure/legend 驱动论文
- sample code 驱动论文
- caption 和正文混合提供条件的论文
- 趋势性表述多于整齐表格的论文

### 3.3 Review 限制

当前 [`frontend/src/pages/review/ReviewPage.vue`](D:\Julyanffzz\IonicLink\frontend\src\pages\review\ReviewPage.vue) 的问题是：

- 主要审的是“当前 record 的字段值”
- 右侧只展示泛化的 evidence 摘要
- 缺少字段级 provenance
- 缺少 sample-level 语义
- 缺少 candidate 与 final record 的区分

因此用户实际上无法判断：

- 当前字段到底来自哪个来源
- 当前记录是否是错误拼接
- 当前记录是“可信候选”还是“已确认记录”

---

## 4. 重构原则

本次重构建议遵循以下原则。

### 4.1 Evidence First

所有结构化记录都必须建立在明确 evidence 之上。

系统优先抽取：

- 文本事实
- 图注事实
- 图例事实
- 表格行事实
- 样品编号事实

而不是优先让模型输出最终 record。

### 4.2 Field-Level Provenance

provenance 必须从 record 级，升级到字段级。

每个关键字段都应尽量能回答：

- 值是什么
- 来自哪里
- 证据类型是什么
- 原始 quote 是什么
- 对应 PDF 位置是什么

### 4.3 Candidate Before Final

结构化对象必须分层：

- `EvidenceFact`
- `FieldCandidate`
- `RecordCandidate`
- `FinalRecord`

不要继续把“候选结果”和“最终入库记录”混在一个对象里。

### 4.4 Observation Split

趋势性结论与定量实验记录必须分流。

- 定量、可结构化、可锚定 -> `FinalRecord`
- 趋势、范围、总结、定性结论 -> `Observation`

### 4.5 Sample-Aware Assembly

组装 record 时必须优先依赖：

- `sample_id`
- `series_id`
- `panel_label`
- `source_page`
- `source_figure`

而不是仅靠文本相似性或字段兼容性合并。

---

## 5. 目标数据模型

## 5.1 EvidenceFact

新增中间对象 `EvidenceFact`，作为抽取链路中的最小事实单元。

建议字段：

```text
EvidenceFact
  id
  literature_id
  run_id
  fact_type
  raw_value
  normalized_value
  source_type
  source_page
  source_label
  quote
  bbox
  image_ref
  sample_id
  series_id
  panel_label
  confidence
  status
```

其中：

- `fact_type`: material / ionic_liquid / cof / load / speed / temperature / film_thickness / trend / sample_id ...
- `source_type`: text / caption / figure / legend / table / inferred
- `status`: extracted / linked / rejected / promoted

## 5.2 FieldEvidence

新增字段级 provenance 结构，用于 Review 与 FinalRecord 关联。

建议结构：

```json
{
  "value": "0.022",
  "confidence": 0.84,
  "evidence": {
    "source_type": "figure_legend",
    "page": 6,
    "source_label": "Fig. 3b",
    "quote": "μ = 0.022",
    "bbox": [0.1, 0.2, 0.3, 0.4],
    "sample_id": "BB4-1-M"
  }
}
```

## 5.3 RecordCandidate

新增候选记录层，不再让 `TribologyData` 直接承担候选态和最终态。

建议字段：

```text
RecordCandidate
  id
  literature_id
  run_id
  sample_id
  series_id
  source_page
  source_label
  material
  ionic_liquid
  cof
  load
  speed
  temperature
  field_evidence_json
  assembly_confidence
  assembly_warnings
  review_status
```

## 5.4 Observation

新增 `Observation`，存储趋势型或总结型信息。

建议字段：

```text
Observation
  id
  literature_id
  run_id
  statement_type
  subject
  statement
  source_page
  source_label
  quote
  confidence
```

### 5.5 FinalRecord

现有 `TribologyData` 作为最终结构化记录保留，但应新增字段级 provenance 载荷。

建议最少增加：

- `sample_id`
- `series_id`
- `field_evidence_json`
- `record_origin`
- `review_status`
- `assembly_notes`

---

## 6. 抽取链路 V2

建议将抽取流程重构为以下阶段。

## Phase A：文献模式识别

先判断文献更适合走哪种策略：

- `table_first`
- `text_first`
- `figure_legend_first`
- `trend_heavy`

本案例建议路由到：

- `figure_legend_first`

### 输出

- 文献模式标签
- 优先页面集合
- 高价值 evidence 区域列表

## Phase B：EvidenceFact 抽取

分别从以下来源抽取最小事实：

- 正文
- 图注
- 图例
- 表格
- 样品映射段落

重点不是一次吐出最终记录，而是先抽：

- `sample_id`
- `ionic_liquid`
- `material`
- `cof`
- `load`
- `speed`
- `film_thickness`
- `trend statement`

### 输出

- `EvidenceFact[]`

## Phase C：样品映射与上下文链接

建立：

- `sample_id -> ionic_liquid`
- `sample_id -> surface/material`
- `sample_id -> panel/figure`
- `sample_id -> condition set`

如果样品锚点缺失，则保留为未组装 fact，不直接升格为 record。

### 输出

- fact link graph
- unresolved fact list

## Phase D：字段组装

将多个 EvidenceFact 聚合成字段候选。

规则：

- 同一字段允许多个候选来源
- 优先级为 table > caption > legend > text > inferred
- 不兼容来源不得自动覆盖

### 输出

- `FieldCandidate[]`

## Phase E：记录组装

仅在以下条件满足时组装 RecordCandidate：

- 存在稳定实体锚点
- 存在 quantitative outcome
- 关键字段来源相互兼容
- evidence 来源能够回指到有限上下文窗口

### 输出

- `RecordCandidate[]`
- `Observation[]`
- `RejectedAssembly[]`

## Phase F：规则验证

入库前执行硬规则过滤：

- 没有 `material + ionic_liquid + quantitative outcome` 不生成定量 record
- 趋势型语句不进入 FinalRecord
- `cof` 不允许跨 source 拼接
- evidence 缺失或字段 provenance 缺失的记录默认不能自动确认

### 输出

- `promoted candidates`
- `blocked candidates`
- `rejected candidates`

---

## 7. 需要新增的规则能力

### 7.1 趋势语句识别

识别类似以下表述：

- remains around
- varies between
- stays nearly constant
- tends to decrease
- shows a trend

这类内容默认转为 `Observation`，而不是 `FinalRecord`。

### 7.2 Sample ID 识别

加强对以下内容的识别：

- `BB5-1-M`
- `BP5-1-M`
- `BB3-8-M`

并将其从 evidence 文本中提升为正式字段：

- `sample_id`
- `series_id`

### 7.3 Panel / Figure 约束

若 `cof` 来自 `Fig. 3b`，而 `ionic_liquid` 仅来自 `Fig. 3d`，则不得自动合并为同一 record。

### 7.4 无证据阻断

若字段值没有字段级 evidence，则：

- UI 中不可 `Confirm`
- 不进入 FinalRecord 自动确认态

---

## 8. 后端改造清单

## 8.1 数据模型

需要修改或新增：

- [`backend/models/tribology.py`](D:\Julyanffzz\IonicLink\backend\models\tribology.py)
- `backend/models/db_models.py`

建议动作：

- 为 `TribologyData` 增加字段级 provenance 支持
- 增加 `EvidenceFact`
- 增加 `RecordCandidate`
- 增加 `Observation`

## 8.2 抽取服务

重点改造：

- [`backend/services/file_service.py`](D:\Julyanffzz\IonicLink\backend\services\file_service.py)
- [`backend/services/llm/prompts.py`](D:\Julyanffzz\IonicLink\backend\services\llm\prompts.py)
- [`backend/services/llm/deduplication.py`](D:\Julyanffzz\IonicLink\backend\services\llm\deduplication.py)
- [`backend/services/extraction_trace_service.py`](D:\Julyanffzz\IonicLink\backend\services\extraction_trace_service.py)

建议动作：

- 将当前“直接产出 record”的 prompt 改为“先产出 EvidenceFact”
- 保留 extraction trace，但 trace 单位从 record 扩展为 fact / candidate
- dedup 不再直接用于最终 record 合并，而是用于 candidate 聚合辅助

## 8.3 新增服务建议

建议新增：

- `services/evidence_fact_service.py`
- `services/record_assembly_service.py`
- `services/observation_service.py`
- `services/review_queue_service.py`

职责分别为：

- fact 提取与持久化
- 从 fact 到 candidate 的组装
- 趋势 observation 的管理
- 基于 provenance 和错误风险生成 review queue

---

## 9. Review 界面改造清单

当前 Review 应从“审整条 record”改为“审字段证据链”。

## 9.1 新的审阅层级

界面主线应为：

`文献 -> RecordCandidate -> 字段 -> 字段级 evidence`

## 9.2 推荐布局

### 左栏：Literature Inbox

- 文献名
- 待审记录数
- 缺证据数
- 低置信度数

### 中栏上部：Record Rail

- 当前文献下所有 `RecordCandidate`
- 每条显示：
  - sample_id
  - material
  - ionic_liquid
  - cof
  - review 状态
  - missing evidence 标记

### 中栏下部：Field Review

- 每个字段一张卡片
- 显示值、置信度、evidence 状态
- 支持编辑、确认、标记问题

### 右栏：Evidence Inspector

- 当前字段
- 来源类型
- 页码
- source label
- quote
- bbox / PDF preview / image preview
- sample_id 对齐状态

## 9.3 当前页面的具体改造方向

重点改造文件：

- [`frontend/src/pages/review/ReviewPage.vue`](D:\Julyanffzz\IonicLink\frontend\src\pages\review\ReviewPage.vue)

建议动作：

- 不再使用单一 `primaryRecord`
- 引入 `RecordCandidate[]`
- 引入当前 `activeRecordCandidate`
- 引入 `activeFieldEvidence`
- grounding 区域改为字段级 inspector，而不是 record 级摘要

## 9.4 Review 交互约束

- 没有字段级 evidence 的字段不可确认
- 没有完整关键字段的 RecordCandidate 不可 `Approve`
- `Approve All` 仅对 evidence 完整、风险低的 candidates 开放

---

## 10. API 改造建议

建议新增或重构以下接口。

## 10.1 Review API

- `GET /api/review/literature/{id}/candidates`
- `GET /api/review/candidates/{candidate_id}`
- `GET /api/review/candidates/{candidate_id}/field-evidence`
- `POST /api/review/candidates/{candidate_id}/confirm`
- `POST /api/review/candidates/{candidate_id}/flag`
- `POST /api/review/candidates/{candidate_id}/promote`

## 10.2 Grounding API

- `GET /api/review/field-evidence/{fact_id}`
- `GET /api/review/pdf/{literature_id}/field-highlight`

## 10.3 Observation API

- `GET /api/review/literature/{id}/observations`
- `POST /api/review/observations/{id}/confirm`

---

## 11. 分阶段实施计划

## Phase 0：止血

目标：先阻止错误 record 继续污染 review 和数据库。

任务：

- 加入“无完整实体锚点不生成定量 record”
- 加入“趋势语句不进 FinalRecord”
- 加入“无字段级 evidence 不可自动确认”
- 下调 `Approve All` 的可用范围

交付：

- 更少但更干净的 record 输出
- 明显减少错拼记录

## Phase 1：字段级 provenance

目标：让系统先支持字段级溯源。

任务：

- 为 `TribologyData` 增加 `field_evidence_json`
- 改造 evidence 解析和坐标存储逻辑
- UI 中显示字段级 source badge

交付：

- Review 中可明确看到“哪个字段来自哪”

## Phase 2：EvidenceFact 中间层

目标：从 record-first 升级为 evidence-first。

任务：

- 新增 `EvidenceFact`
- 重写 LLM prompt 输出目标
- 新建 fact 持久化与 trace
- fact 与 sample_id、source_label 建立链接

交付：

- 可复用的 evidence 原子层

## Phase 3：RecordCandidate 组装层

目标：把 candidate 和 final record 分开。

任务：

- 新增 `RecordCandidate`
- 实现 fact -> field -> candidate 组装
- 分离 `Observation`
- UI 改为 candidate review

交付：

- Review 审的是 candidate，不是最终表

## Phase 4：文献类型路由

目标：按论文结构选择抽取策略。

任务：

- 实现文献模式分类
- 增加 `figure_legend_first` 与 `trend_heavy` 路由
- 针对样品编码型论文增强抽取规则

交付：

- 对复杂论文类型更稳定的抽取效果

---

## 12. 成功标准

本次重构完成后，应达到以下结果：

- 错误拼接 record 数量显著下降
- 每个关键字段都能展示字段级 provenance
- Review 中可以判断“字段来自哪”和“字段是否能确认”
- 趋势类结论不再污染结构化数据表
- evidence grounding 从展示层升级为判定层
- 对 figure/legend/sample code 驱动论文的处理更稳定

---

## 13. 当前最值得先做的 8 件事

1. 给 FinalRecord 加入“无字段级证据不可确认”的硬规则。
2. 在候选层新增 `sample_id` 和 `series_id`。
3. 把趋势型描述从结构化 record 中分流出去。
4. 为 `TribologyData` 增加 `field_evidence_json`。
5. 在 Review 中加入 `RecordCandidate` 列表，不再只审单一 record。
6. 将右侧 grounding 改为字段级 inspector。
7. 将 extraction trace 的单位从 record 扩展到 fact 和 candidate。
8. 为 figure/legend 驱动论文增加专门的抽取模式。

---

## 14. 一句话总结

IonicLink 下一步不应继续围绕“怎么让模型一次输出更完整 record”迭代，而应转向“先拿到可靠 evidence fact，再组装字段和记录”的 evidence-first 架构。
