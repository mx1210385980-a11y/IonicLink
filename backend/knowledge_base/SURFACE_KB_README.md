# 表面材料知识库 (Surface Knowledge Base)

## 概述

表面材料知识库用于标准化摩擦学数据中的材料名称/基底表面术语，确保数据提取和存储时使用统一的术语。

## 标准术语

知识库定义了以下 6 个标准术语：

| 标准术语 | 中文名 | 常见别名 |
|---------|--------|---------|
| Mica | 云母 | mica, muscovite, fluorophlogopite, 云母, 白云母, 钾云母 |
| HOPG | 高定向热解石墨 | hopg, highly oriented pyrolytic graphite, pyrolytic graphite, 高定向热解石墨, 高序热解石墨 |
| Au(111) | 金电极 | au(111), au111, gold, gold(111), 金电极, 金(111), 金表面 |
| Silica | 二氧化硅 | silica, SiO2, SiO₂, silicon dioxide, quartz, 二氧化硅, 石英, fused silica |
| Stainless steel | 不锈钢 | stainless steel, 不锈钢, SS, SUS, SUS304, 304SS, SUS316, 316SS |
| Titanium | 钛 | titanium, Ti, 钛, CP-Ti, cp ti, commercially pure titanium |

## 使用方式

### 1. 直接使用便捷函数

```python
from services.surface_knowledge_base import normalize_surface, get_surface_with_chinese

# 标准化术语
standard = normalize_surface("云母")  # 返回: "Mica"

# 获取术语及其中文名
standard, chinese = get_surface_with_chinese("SiO2")  # 返回: ("Silica", "二氧化硅")
```

### 2. 使用知识库实例

```python
from services.surface_knowledge_base import surface_kb

# 查询术语
standard = surface_kb.query("muscovite")  # 返回: "Mica"

# 获取中文名
chinese = surface_kb.get_chinese_name("Mica")  # 返回: "云母"

# 获取所有标准术语
all_terms = surface_kb.get_all_standards()

# 获取术语完整信息
info = surface_kb.get_term_info("HOPG")
# 返回: {"chinese_name": "高定向热解石墨", "aliases": [...], "patterns": [...]}
```

## 集成到数据提取流程

知识库已集成到 `llm_service.py` 中，在数据提取后会自动标准化 `material_name` 字段：

```python
def normalize_surface_terms(data_items: List[dict]) -> List[dict]:
    for item in data_items:
        # 标准化 material_name 字段
        if 'material_name' in item and item['material_name']:
            original = item['material_name']
            normalized = normalize_surface(original)
            if normalized and normalized != original:
                item['material_name'] = normalized
                print(f"[Surface Normalization] material_name: '{original}' -> '{normalized}'")
```

## 扩展知识库

如需添加新的术语或别名，编辑 `surface_knowledge_base.py` 中的 `STANDARD_TERMS` 字典：

```python
STANDARD_TERMS = {
    "NewTerm": {
        "chinese_name": "新术语",
        "aliases": ["alias1", "alias2", "别名1"],
        "patterns": [
            r'\bpattern1\b',
            r'\bpattern2\b',
        ]
    },
    # ... 其他术语
}
```

或使用动态添加方法：

```python
surface_kb.add_alias("Mica", "new_alias_for_mica")
```

## 匹配逻辑

知识库使用三级匹配策略：

1. **精确匹配**：别名完全匹配（不区分大小写）
2. **模式匹配**：使用正则表达式匹配
3. **模糊匹配**：检查包含关系（需满足相似度阈值）

## 数据流

```
文献内容
    ↓
LLM 提取 (material_name, ...)
    ↓
normalize_surface_terms() 标准化 material_name
    ↓
数据库存储 (统一术语)
```
