# 离子液体知识库 (Ionic Liquid Knowledge Base)

## 概述

离子液体知识库用于标准化摩擦学数据中的离子液体术语，确保数据提取和存储时使用统一的命名格式。

## 标准术语

知识库定义了以下 18 种标准离子液体：

### 咪唑类 (Imidazolium-based)
| 标准术语 | 中文名 | 化学式 |
|---------|--------|--------|
| [BMIM][PF6] | 1-丁基-3-甲基咪唑六氟磷酸盐 | C8H15F6N2P |
| [BMIM][BF4] | 1-丁基-3-甲基咪唑四氟硼酸盐 | C8H15BF4N2 |
| [BMIM][TFSI] | 1-丁基-3-甲基咪唑双(三氟甲烷磺酰)亚胺盐 | C10H15F6N3O4S2 |
| [EMIM][BF4] | 1-乙基-3-甲基咪唑四氟硼酸盐 | C6H11BF4N2 |
| [EMIM][TFSI] | 1-乙基-3-甲基咪唑双(三氟甲烷磺酰)亚胺盐 | C8H11F6N3O4S2 |
| [HMIM][PF6] | 1-己基-3-甲基咪唑六氟磷酸盐 | C10H19F6N2P |
| [OMIM][PF6] | 1-辛基-3-甲基咪唑六氟磷酸盐 | C12H23F6N2P |

### 吡啶类 (Pyridinium-based)
| 标准术语 | 中文名 | 化学式 |
|---------|--------|--------|
| [BuPy][BF4] | N-丁基吡啶四氟硼酸盐 | C9H14BF4N |

### 季铵盐类 (Ammonium-based)
| 标准术语 | 中文名 | 化学式 |
|---------|--------|--------|
| [N4444][BTA] | 四丁基铵双(三氟甲烷磺酰)亚胺盐 | C20H36F6N2O4S2 |

### 季鏻盐类 (Phosphonium-based)
| 标准术语 | 中文名 | 化学式 |
|---------|--------|--------|
| [P66614][BTA] | 三己基十四烷基鏻双(三氟甲烷磺酰)亚胺盐 | C38H76F6NO4PS |
| [P66614][BOB] | 三己基十四烷基鏻双(草酸根)硼酸盐 | C38H76BO4P |
| [P66614][BMB] | 三己基十四烷基鏻双(丙二酸根)硼酸盐 | C40H80BO4P |
| [P4444][BTA] | 四丁基鏻双(三氟甲烷磺酰)亚胺盐 | C20H36F6NO4PS2 |

### 吡咯烷类 (Pyrrolidinium-based)
| 标准术语 | 中文名 | 化学式 |
|---------|--------|--------|
| [P14][TFSI] | N-甲基-N-丙基吡咯烷双(三氟甲烷磺酰)亚胺盐 | C10H18F6N2O4S2 |
| [Pyr13][TFSI] | N-甲基-N-丙基吡咯烷双(三氟甲烷磺酰)亚胺盐 | C10H18F6N2O4S2 |

### 哌啶类 (Piperidinium-based)
| 标准术语 | 中文名 | 化学式 |
|---------|--------|--------|
| [PIP14][TFSI] | N-甲基-N-丁基哌啶双(三氟甲烷磺酰)亚胺盐 | C12H22F6N2O4S2 |

### 胍类 (Guanidinium-based)
| 标准术语 | 中文名 | 化学式 |
|---------|--------|--------|
| [hC3C1C1][TFSI] | N,N,N',N'-四甲基-N-丙基胍双(三氟甲烷磺酰)亚胺盐 | C10H20F6N4O4S2 |

### 吗啉类 (Morpholinium-based)
| 标准术语 | 中文名 | 化学式 |
|---------|--------|--------|
| [MOR11][TFSI] | N-甲基-N-乙基吗啉双(三氟甲烷磺酰)亚胺盐 | C9H16F6N2O5S2 |

## 使用方式

### 1. 直接使用便捷函数

```python
from services.il_knowledge_base import normalize_ionic_liquid, get_il_with_info

# 标准化术语
standard = normalize_ionic_liquid("bmim pf6")  # 返回: "[BMIM][PF6]"

# 获取术语及其中文名和化学式
standard, chinese, formula = get_il_with_info("emim tfsi")
# 返回: ("[EMIM][TFSI]", "1-乙基-3-甲基咪唑双(三氟甲烷磺酰)亚胺盐", "C8H11F6N3O4S2")
```

### 2. 使用知识库实例

```python
from services.il_knowledge_base import il_kb

# 查询术语
standard = il_kb.query("[EMIM][NTf2]")  # 返回: "[EMIM][TFSI]"

# 获取中文名
chinese = il_kb.get_chinese_name("[BMIM][PF6]")

# 获取化学式
formula = il_kb.get_formula("[BMIM][PF6]")  # 返回: "C8H15F6N2P"

# 获取所有标准术语
all_terms = il_kb.get_all_standards()

# 获取术语完整信息
info = il_kb.get_term_info("[P66614][BTA]")
# 返回: {"chinese_name": "...", "formula": "...", "aliases": [...], "patterns": [...]}
```

## 集成到数据提取流程

知识库已集成到 `llm_service.py` 中，在数据提取后会自动标准化 `ionic_liquid` 字段：

```python
def normalize_ionic_liquid_terms(data_items: List[dict]) -> List[dict]:
    for item in data_items:
        # 标准化 ionic_liquid 字段
        if 'ionic_liquid' in item and item['ionic_liquid']:
            original = item['ionic_liquid']
            normalized = normalize_ionic_liquid(original)
            if normalized and normalized != original:
                item['ionic_liquid'] = normalized
                print(f"[IL Normalization] ionic_liquid: '{original}' -> '{normalized}'")
```

## 扩展知识库

如需添加新的离子液体或别名，编辑 `il_knowledge_base.py` 中的 `STANDARD_TERMS` 字典：

```python
STANDARD_TERMS = {
    "[NEWIL][Anion]": {
        "chinese_name": "新离子液体中文名",
        "formula": "化学式",
        "aliases": ["alias1", "alias2"],
        "patterns": [
            r'\[?newil\]?\s*\[?anion\]?',
        ]
    },
    # ... 其他术语
}
```

或使用动态添加方法：

```python
il_kb.add_alias("[BMIM][PF6]", "new_alias")
```

## 命名规范

离子液体标准术语遵循以下格式：

- **阳离子**: 使用方括号 `[Cation]`
  - 咪唑类: `[BMIM]`, `[EMIM]`, `[HMIM]`, `[OMIM]` 等
  - 鏻盐类: `[P66614]`, `[P4444]` 等
  - 铵盐类: `[N4444]` 等
  - 吡咯烷类: `[P14]`, `[Pyr13]` 等
  
- **阴离子**: 使用方括号 `[Anion]`
  - `[PF6]` - 六氟磷酸盐
  - `[BF4]` - 四氟硼酸盐
  - `[TFSI]` / `[NTf2]` - 双(三氟甲烷磺酰)亚胺盐
  - `[BTA]` - 双(三氟甲烷磺酰)亚胺盐（别名）
  - `[BOB]` - 双(草酸根)硼酸盐
  - `[BMB]` - 双(丙二酸根)硼酸盐

## 匹配逻辑

知识库使用多级匹配策略：

1. **精确匹配**：别名完全匹配（不区分大小写）
2. **模式匹配**：使用正则表达式匹配
3. **规范化匹配**：去除空格和方括号后匹配

## 数据流

```
文献内容
    ↓
LLM 提取 (ionic_liquid, ...)
    ↓
normalize_ionic_liquid_terms() 标准化
    ↓
数据库存储 (统一术语)
```
