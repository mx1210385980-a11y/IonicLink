"""
表面材料知识库 (Surface Material Knowledge Base)
用于标准化基底表面术语
"""

from typing import Dict, List, Optional, Tuple
import re


class SurfaceKnowledgeBase:
    """
    基底表面术语知识库
    提供术语标准化、别名查询等功能
    """
    
    # 标准术语定义: 标准名称 -> {中文名, 别名列表, 匹配模式}
    STANDARD_TERMS: Dict[str, Dict] = {
        "Mica": {
            "chinese_name": "云母",
            "aliases": [
                "mica", "Mica", "MICA",
                "云母", "白云母", "钾云母",
                "muscovite", "Muscovite", "MUSCOVITE",
                "fluorophlogopite", "Fluorophlogopite",
            ],
            "patterns": [
                r'\bmica\b',
                r'\b云母\b',
                r'\bmuscovite\b',
                r'\bfluorophlogopite\b',
            ]
        },
        "HOPG": {
            "chinese_name": "高定向热解石墨",
            "aliases": [
                "hopg", "HOPG", "Hopg",
                "高定向热解石墨", "高序热解石墨",
                "highly oriented pyrolytic graphite",
                "Highly Oriented Pyrolytic Graphite",
                "highly-ordered pyrolytic graphite",
                "pyrolytic graphite", "Pyrolytic Graphite",
            ],
            "patterns": [
                r'\bhopg\b',
                r'\bhighly\s+oriented\s+pyrolytic\s+graphite\b',
                r'\bhighly-ordered\s+pyrolytic\s+graphite\b',
                r'\bpyrolytic\s+graphite\b',
                r'\b高定向热解石墨\b',
                r'\b高序热解石墨\b',
            ]
        },
        "Au(111)": {
            "chinese_name": "金电极",
            "aliases": [
                "au(111)", "Au(111)", "AU(111)",
                "au111", "Au111", "AU111",
                "金电极", "金(111)", "金表面",
                "gold", "Gold", "GOLD",
                "gold(111)", "Gold(111)", "GOLD(111)",
                "gold surface", "Gold Surface",
                "au film", "Au film", "gold film",
            ],
            "patterns": [
                r'\bau\(111\)\b',
                r'\bau111\b',
                r'\bgold\(111\)\b',
                r'\b金\(?111\)?\b',
                r'\b金电极\b',
                r'\bgold\s+(?:surface|film|substrate)\b',
                r'\bau\s+(?:surface|film|substrate)\b',
            ]
        },
        "Silica": {
            "chinese_name": "二氧化硅",
            "aliases": [
                "silica", "Silica", "SILICA",
                "二氧化硅", "石英",
                "sio2", "SiO2", "SiO₂", " SIO2 ",
                "silicon dioxide", "Silicon Dioxide",
                "quartz", "Quartz", "QUARTZ",
                "fused silica", "Fused Silica",
            ],
            "patterns": [
                r'\bsilica\b',
                r'\bsio2\b',
                r'\bsio₂\b',
                r'\bsilicon\s+dioxide\b',
                r'\b二氧化硅\b',
                r'\b石英\b',
                r'\bquartz\b',
                r'\bfused\s+silica\b',
            ]
        },
        "Stainless steel": {
            "chinese_name": "不锈钢",
            "aliases": [
                "stainless steel", "Stainless Steel", "Stainless steel", "STAINLESS STEEL",
                "不锈钢", "不锈",
                "ss", "SS", "Ss",
                "sus", "SUS",
                "sus304", "SUS304", "304ss", "304SS",
                "sus316", "SUS316", "316ss", "316SS",
                "austenitic stainless steel",
                "martensitic stainless steel",
            ],
            "patterns": [
                r'\bstainless\s+steel\b',
                r'\b不锈钢\b',
                r'\bsus\d+\b',
                r'\b\d+ss\b',
                r'\b\d+\s* stainless\s+steel\b',
            ]
        },
        "Titanium": {
            "chinese_name": "钛",
            "aliases": [
                "titanium", "Titanium", "TITANIUM",
                "钛", "纯钛",
                "ti", "Ti", "TI",
                "cp ti", "CP Ti", "CP-Ti", "cp-ti",
                "commercially pure titanium",
                "grade titanium",
            ],
            "patterns": [
                r'\btitanium\b',
                r'\b钛\b',
                r'\bcp[-\s]?ti\b',
                r'\bcommercially\s+pure\s+titanium\b',
                r'\bgrade\s*\d+\s*titanium\b',
                r'\btitanium\s+alloy\b',
            ]
        },
        "Graphite": {
            "chinese_name": "石墨",
            "aliases": [
                "graphite", "Graphite", "GRAPHITE",
                "石墨",
                "natural graphite", "Natural Graphite",
            ],
            "patterns": [
                r'\bgraphite\b',
                r'\b石墨\b',
                r'\bnatural\s+graphite\b',
            ]
        },
    }
    
    def __init__(self):
        """初始化知识库，构建反向索引"""
        self._build_reverse_index()
    
    def _build_reverse_index(self):
        """构建从别名到标准术语的反向索引"""
        self.alias_to_standard: Dict[str, str] = {}
        
        for standard_name, info in self.STANDARD_TERMS.items():
            # 添加标准名称本身
            self.alias_to_standard[standard_name.lower()] = standard_name
            
            # 添加所有别名
            for alias in info.get("aliases", []):
                self.alias_to_standard[alias.lower()] = standard_name
    
    def query(self, term: Optional[str]) -> Optional[str]:
        """
        查询术语对应的标准名称
        
        Args:
            term: 输入术语（可能是不规范的形式）
            
        Returns:
            标准术语名称，如果未找到则返回 None
        """
        if not term:
            return None
        
        term_clean = term.strip()
        if not term_clean:
            return None
        
        # 1. 直接匹配（不区分大小写）
        lower_term = term_clean.lower()
        if lower_term in self.alias_to_standard:
            return self.alias_to_standard[lower_term]
        
        # 2. 模式匹配
        for standard_name, info in self.STANDARD_TERMS.items():
            for pattern in info.get("patterns", []):
                if re.search(pattern, term_clean, re.IGNORECASE):
                    return standard_name
        
        # 3. 模糊匹配：包含关系
        for standard_name, info in self.STANDARD_TERMS.items():
            # 检查输入是否包含标准名称或其别名
            for alias in info.get("aliases", []):
                if alias.lower() in lower_term or lower_term in alias.lower():
                    # 长度相似度检查（避免过短的匹配）
                    if len(term_clean) >= 3 and len(alias) >= 3:
                        # 计算相似度（简单的包含关系）
                        if len(set(term_clean.lower()) & set(alias.lower())) >= min(len(term_clean), len(alias)) * 0.7:
                            return standard_name
        
        return None
    
    def normalize(self, term: Optional[str]) -> Optional[str]:
        """
        标准化术语（query的别名）
        
        Args:
            term: 输入术语
            
        Returns:
            标准化后的术语，如果未找到则返回原值
        """
        standard = self.query(term)
        return standard if standard else term
    
    def get_chinese_name(self, standard_term: str) -> Optional[str]:
        """
        获取标准术语的中文名
        
        Args:
            standard_term: 标准术语名称
            
        Returns:
            中文名称，如果不存在则返回 None
        """
        if standard_term in self.STANDARD_TERMS:
            return self.STANDARD_TERMS[standard_term].get("chinese_name")
        return None
    
    def get_all_standards(self) -> List[str]:
        """获取所有标准术语列表"""
        return list(self.STANDARD_TERMS.keys())
    
    def get_term_info(self, standard_term: str) -> Optional[Dict]:
        """获取术语的完整信息"""
        return self.STANDARD_TERMS.get(standard_term)
    
    def add_alias(self, standard_term: str, alias: str):
        """
        动态添加别名（用于知识库扩展）
        
        Args:
            standard_term: 标准术语
            alias: 新别名
        """
        if standard_term not in self.STANDARD_TERMS:
            raise ValueError(f"标准术语 '{standard_term}' 不存在")
        
        # 添加到别名列表
        if alias not in self.STANDARD_TERMS[standard_term]["aliases"]:
            self.STANDARD_TERMS[standard_term]["aliases"].append(alias)
        
        # 更新反向索引
        self.alias_to_standard[alias.lower()] = standard_term


# 全局知识库实例
surface_kb = SurfaceKnowledgeBase()


def normalize_surface(term: Optional[str]) -> Optional[str]:
    """
    便捷函数：标准化表面材料术语
    
    Args:
        term: 输入术语
        
    Returns:
        标准化后的术语
    """
    return surface_kb.normalize(term)


def get_surface_with_chinese(term: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """
    获取标准化术语及其中文名
    
    Args:
        term: 输入术语
        
    Returns:
        (标准术语, 中文名) 元组
    """
    standard = surface_kb.normalize(term)
    if standard:
        chinese = surface_kb.get_chinese_name(standard)
        return standard, chinese
    return term, None
