# IonicLink Evidence-First 重构任务拆解

更新时间：2026-04-04

## 1. 文档目的

本文档将 [`evidence-first-review-implementation-plan.md`](D:\Julyanffzz\IonicLink\Designdocuments\evidence-first-review-implementation-plan.md) 进一步拆解为可执行任务。

拆解原则：

- 优先做止血和最短闭环
- 每项任务尽量落到明确文件
- 每项任务定义完成标准
- 尽量避免“大改一切”的模糊工程

---

## 2. 当前代码基线判断

在进入实施前，当前代码状态可以概括为：

- 后端已有 `ExtractionRun` 和 `ExtractionCandidate`
- 最终记录仍然直接落到 `TribologyData`
- `TribologyData` 仍是 record 级 evidence，而非字段级 evidence
- Review 页已经出现了 `Record Rail` 雏形，但仍然围绕 `TribologyData` 工作
- `getRecordEvidence()` 仍然是按 record 拉 evidence，而不是按 field 拉 evidence

这意味着当前最合理的策略不是推倒重来，而是：

1. 先给现有 `TribologyData` 补字段级 provenance 承载能力
2. 再把 candidate 和 final record 分层
3. 最后再引入完整的 `EvidenceFact`

---

## 3. 实施顺序总览

建议按 5 个工作流并行拆解，但按依赖顺序推进：

1. `W0` 止血规则
2. `W1` 数据模型升级
3. `W2` Review API 与前端改造
4. `W3` 抽取链路升级到 candidate-first
5. `W4` 完整 evidence-first

建议节奏：

- 第 1 周：完成 `W0 + W1`
- 第 2 周：完成 `W2`
- 第 3 周：完成 `W3`
- 第 4 周及以后：推进 `W4`

---

## 4. W0：止血规则

目标：先减少错误 record 继续进入 review 和数据库。

## 4.1 任务 W0-1：阻断无核心锚点 record

### 说明

若缺少以下任意关键要素，不进入最终 `TribologyData`：

- `material`
- `ionic_liquid`
- `quantitative outcome`，优先是 `cof`

### 涉及文件

- [`backend/services/file_service.py`](D:\Julyanffzz\IonicLink\backend\services\file_service.py)
- [`backend/services/llm/deduplication.py`](D:\Julyanffzz\IonicLink\backend\services\llm\deduplication.py)

### 动作

- 在最终 record 构建前加入更严格的 gate
- 记录被阻断原因到 trace

### 完成标准

- 错误拼接 record 数明显下降
- trace 中可以看到阻断原因

## 4.2 任务 W0-2：趋势语句分流

### 说明

将“范围趋势”“总结性结论”从结构化定量 record 中剥离。

### 涉及文件

- [`backend/services/llm/prompts.py`](D:\Julyanffzz\IonicLink\backend\services\llm\prompts.py)
- [`backend/services/file_service.py`](D:\Julyanffzz\IonicLink\backend\services\file_service.py)

### 动作

- 在 prompt 里强化“趋势不等于 record”
- 在后处理里识别 `remains around`、`varies between`、`stays nearly constant` 等模式

### 完成标准

- 趋势语句不再直接进入 `TribologyData`

## 4.3 任务 W0-3：无证据不可确认

### 说明

当前 UI 里没有字段级 evidence 也可点 `Confirm`，风险过高。

### 涉及文件

- [`frontend/src/pages/review/ReviewPage.vue`](D:\Julyanffzz\IonicLink\frontend\src\pages\review\ReviewPage.vue)

### 动作

- 若字段 evidence 缺失，则禁用该字段确认
- 若 record 有关键字段 evidence 缺失，则禁用 `Approve All`

### 完成标准

- UI 中确认动作与 evidence 完整性绑定

---

## 5. W1：数据模型升级

目标：在不引入完整 `EvidenceFact` 前，先给现有模型增加字段级 provenance 容器。

## 5.1 任务 W1-1：给 TribologyData 增加字段级 evidence 容器

### 说明

为现有 `TribologyData` 增加承载字段级 provenance 的 JSON 字段。

### 建议新增字段

- `sample_id`
- `series_id`
- `field_evidence_json`
- `review_status`
- `record_origin`
- `assembly_notes`

### 涉及文件

- [`backend/models/db_models.py`](D:\Julyanffzz\IonicLink\backend\models\db_models.py)
- [`backend/models/tribology.py`](D:\Julyanffzz\IonicLink\backend\models\tribology.py)
- Alembic migration 文件

### 动作

- 扩展 SQLAlchemy 模型
- 扩展 Pydantic 模型
- 添加迁移

### 完成标准

- 数据库可保存字段级 provenance JSON
- 前后端 DTO 能读写这些字段

## 5.2 任务 W1-2：定义字段级 provenance schema

### 说明

统一 `field_evidence_json` 的结构，避免后续前后端各自定义。

### 推荐结构

```json
{
  "material": {
    "value": "HOPG",
    "confidence": 0.81,
    "evidence": {
      "source_type": "text",
      "page": 6,
      "source_label": "caption",
      "quote": "on HOPG",
      "bbox": [0.1, 0.2, 0.3, 0.4],
      "sample_id": "BB4-1-M"
    }
  }
}
```

### 涉及文件

- [`backend/models/tribology.py`](D:\Julyanffzz\IonicLink\backend\models\tribology.py)
- [`frontend/src/lib/api.ts`](D:\Julyanffzz\IonicLink\frontend\src\lib\api.ts)

### 完成标准

- 字段级 evidence JSON 有稳定类型定义

---

## 6. W2：Review API 与前端改造

目标：让 Review 真正围绕 candidate / field / evidence 工作。

## 6.1 任务 W2-1：增加 record field evidence API

### 说明

当前 `getRecordEvidence()` 是 record 级接口，不够用。

### 建议新增接口

- `GET /api/review/records/{record_id}/field-evidence`
- `GET /api/review/records/{record_id}/field-evidence/{field_key}`

### 涉及文件

- [`backend/routers/extraction.py`](D:\Julyanffzz\IonicLink\backend\routers\extraction.py) 或未来 `review.py`
- [`frontend/src/lib/api.ts`](D:\Julyanffzz\IonicLink\frontend\src\lib\api.ts)

### 完成标准

- 前端可以按字段获取 grounding 数据

## 6.2 任务 W2-2：ReviewPage 改为字段级 evidence inspector

### 说明

当前 Review 页已有 `Record Rail` 雏形，但右侧 evidence 仍偏 record 级摘要。

### 涉及文件

- [`frontend/src/pages/review/ReviewPage.vue`](D:\Julyanffzz\IonicLink\frontend\src\pages\review\ReviewPage.vue)

### 动作

- 保留左侧文献和中间 record rail
- 将右侧改为字段级 inspector
- 当前字段切换时，右侧同步切换 evidence

### 右侧至少展示

- `field`
- `resolved value`
- `source type`
- `page`
- `source label`
- `quote`
- `bbox / preview`
- `sample_id alignment`

### 完成标准

- 用户能够回答“这个字段来自哪里”

## 6.3 任务 W2-3：Confirm 逻辑绑定字段 evidence

### 涉及文件

- [`frontend/src/pages/review/ReviewPage.vue`](D:\Julyanffzz\IonicLink\frontend\src\pages\review\ReviewPage.vue)

### 动作

- 字段缺 evidence -> 字段按钮禁用
- 关键字段不完整 -> record confirm 禁用

### 完成标准

- Confirm 不再只是视觉动作，而是受 evidence 规则约束

---

## 7. W3：candidate-first 抽取升级

目标：先把“候选记录”和“最终记录”分开。

## 7.1 任务 W3-1：引入 RecordCandidate 表

### 建议字段

- `literature_id`
- `run_id`
- `sample_id`
- `series_id`
- `field_evidence_json`
- `assembly_confidence`
- `assembly_warnings`
- `review_status`

### 涉及文件

- [`backend/models/db_models.py`](D:\Julyanffzz\IonicLink\backend\models\db_models.py)
- 新 migration

### 完成标准

- 候选记录可独立持久化

## 7.2 任务 W3-2：抽取结果先入 RecordCandidate

### 说明

当前 LLM 输出经过后处理后直接进入 `TribologyData`。需要先进入 candidate 层。

### 涉及文件

- [`backend/services/file_service.py`](D:\Julyanffzz\IonicLink\backend\services\file_service.py)

### 动作

- 抽取结果不再直接 `db.add_all(TribologyData)`
- 先保存 `RecordCandidate`
- review 通过后再 promote 为 `TribologyData`

### 完成标准

- 最终记录与候选记录彻底分层

## 7.3 任务 W3-3：新增 promote 流程

### 建议接口

- `POST /api/review/candidates/{candidate_id}/promote`

### 完成标准

- FinalRecord 的生成有明确审阅门槛

---

## 8. W4：完整 evidence-first

目标：引入 `EvidenceFact`，从根本上重建抽取对象。

## 8.1 任务 W4-1：引入 EvidenceFact 表

### 建议字段

- `fact_type`
- `raw_value`
- `normalized_value`
- `source_type`
- `source_page`
- `source_label`
- `quote`
- `bbox`
- `sample_id`
- `series_id`
- `panel_label`
- `confidence`
- `status`

### 涉及文件

- [`backend/models/db_models.py`](D:\Julyanffzz\IonicLink\backend\models\db_models.py)
- migration

## 8.2 任务 W4-2：抽取 prompt 改为 fact 输出

### 涉及文件

- [`backend/services/llm/prompts.py`](D:\Julyanffzz\IonicLink\backend\services\llm\prompts.py)

### 动作

- 新增 fact extraction prompt
- 将 current record prompt 退为兼容模式

## 8.3 任务 W4-3：新增 fact 组装服务

### 建议新增文件

- `backend/services/evidence_fact_service.py`
- `backend/services/record_assembly_service.py`
- `backend/services/observation_service.py`

### 完成标准

- 抽取逻辑从“直接 record”改成“fact -> candidate -> final”

---

## 9. W5：Observation 分流

目标：把趋势类内容从定量记录中剥离。

## 9.1 任务 W5-1：新增 Observation 表

### 建议字段

- `statement_type`
- `subject`
- `statement`
- `source_page`
- `source_label`
- `quote`
- `confidence`

### 涉及文件

- [`backend/models/db_models.py`](D:\Julyanffzz\IonicLink\backend\models\db_models.py)

## 9.2 任务 W5-2：趋势型内容分流逻辑

### 涉及文件

- [`backend/services/file_service.py`](D:\Julyanffzz\IonicLink\backend\services\file_service.py)
- [`backend/services/llm/prompts.py`](D:\Julyanffzz\IonicLink\backend\services\llm\prompts.py)

### 完成标准

- 趋势 statement 不再污染主 record 表

---

## 10. 文件级实施顺序

建议按以下文件顺序推进。

### 第一批：立即开始

- [`backend/models/db_models.py`](D:\Julyanffzz\IonicLink\backend\models\db_models.py)
- [`backend/models/tribology.py`](D:\Julyanffzz\IonicLink\backend\models\tribology.py)
- [`backend/services/file_service.py`](D:\Julyanffzz\IonicLink\backend\services\file_service.py)
- [`frontend/src/pages/review/ReviewPage.vue`](D:\Julyanffzz\IonicLink\frontend\src\pages\review\ReviewPage.vue)
- [`frontend/src/lib/api.ts`](D:\Julyanffzz\IonicLink\frontend\src\lib\api.ts)

### 第二批：结构升级

- [`backend/services/llm/prompts.py`](D:\Julyanffzz\IonicLink\backend\services\llm\prompts.py)
- [`backend/services/llm/deduplication.py`](D:\Julyanffzz\IonicLink\backend\services\llm\deduplication.py)
- [`backend/services/extraction_trace_service.py`](D:\Julyanffzz\IonicLink\backend\services\extraction_trace_service.py)
- `backend/routers/review.py` 或现有 extraction router 中 review 分支

### 第三批：新服务

- `backend/services/evidence_fact_service.py`
- `backend/services/record_assembly_service.py`
- `backend/services/observation_service.py`

---

## 11. 建议的第一个实际开发冲刺

如果只开一个短冲刺，建议范围收在以下 6 项：

1. 给 `TribologyData` 增加 `field_evidence_json`
2. 给 `TribologyData` 增加 `sample_id`、`series_id`、`review_status`
3. 在 `file_service.py` 中增加“趋势不入 final record”规则
4. 在 `file_service.py` 中增加“缺核心锚点不入 final record”规则
5. 在 `api.ts` 中增加字段级 evidence 类型定义
6. 在 `ReviewPage.vue` 中把右侧 grounding 改成字段级 evidence inspector

这个冲刺不需要一次完成完整 `EvidenceFact`，但能先把平台从“错了也照样 confirm”推进到“至少可以解释为什么不能 confirm”。

---

## 12. 验收标准

第一阶段完成后，应达到以下结果：

- Review 中每个关键字段都能显示 evidence 状态
- 缺 evidence 的字段无法确认
- 趋势类内容显著减少出现在 final record 中
- 错误拼接 record 数量下降
- 后续完整 `EvidenceFact` 改造已有稳定落点

---

## 13. 一句话总结

正确的推进方式不是立刻重写整个平台，而是先给现有 record 流程补上字段级 provenance 和确认约束，再逐步把抽取对象下沉到 `EvidenceFact`。
