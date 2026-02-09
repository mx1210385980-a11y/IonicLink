"""
知识库模块 (Knowledge Base Module)

提供表面材料和离子液体的术语标准化功能。
"""

from .surface_knowledge_base import (
    SurfaceKnowledgeBase,
    surface_kb,
    normalize_surface,
    get_surface_with_chinese,
)

from .il_knowledge_base import (
    IonicLiquidKnowledgeBase,
    il_kb,
    normalize_ionic_liquid,
    get_il_with_info,
)

__all__ = [
    # 表面材料知识库
    "SurfaceKnowledgeBase",
    "surface_kb",
    "normalize_surface",
    "get_surface_with_chinese",
    # 离子液体知识库
    "IonicLiquidKnowledgeBase",
    "il_kb",
    "normalize_ionic_liquid",
    "get_il_with_info",
]
