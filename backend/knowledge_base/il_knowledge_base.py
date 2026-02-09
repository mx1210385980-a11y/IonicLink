"""
离子液体知识库 (Ionic Liquid Knowledge Base)
用于标准化离子液体术语
"""

from typing import Dict, List, Optional, Tuple
import re


class IonicLiquidKnowledgeBase:
    """
    离子液体术语知识库
    提供术语标准化、别名查询等功能
    """
    
    # 标准术语定义: 标准名称 -> {中文名, 别名列表, 匹配模式, 化学式}
    STANDARD_TERMS: Dict[str, Dict] = {
        # 咪唑类离子液体 (Imidazolium-based)
        "[BMIM][PF6]": {
            "chinese_name": "1-丁基-3-甲基咪唑六氟磷酸盐",
            "formula": "C8H15F6N2P",
            "aliases": [
                "[BMIM][PF6]", "[bmim][pf6]", "BMIM PF6", "bmim pf6",
                "1-butyl-3-methylimidazolium hexafluorophosphate",
                "1-butyl-3-methylimidazolium PF6",
                "[C4MIM][PF6]", "[C4mim][PF6]",
            ],
            "patterns": [
                r'\[?bmim\]?\s*\[?pf6\]?',
                r'\b1-butyl-3-methylimidazolium\s+hexafluorophosphate\b',
                r'\b[Cc]4[Mm]im\s+PF6\b',
            ]
        },
        "[BMIM][BF4]": {
            "chinese_name": "1-丁基-3-甲基咪唑四氟硼酸盐",
            "formula": "C8H15BF4N2",
            "aliases": [
                "[BMIM][BF4]", "[bmim][bf4]", "BMIM BF4", "bmim bf4",
                "1-butyl-3-methylimidazolium tetrafluoroborate",
                "1-butyl-3-methylimidazolium BF4",
                "[C4MIM][BF4]", "[C4mim][BF4]",
            ],
            "patterns": [
                r'\[?bmim\]?\s*\[?bf4\]?',
                r'\b1-butyl-3-methylimidazolium\s+tetrafluoroborate\b',
            ]
        },
        "[EMIM][BF4]": {
            "chinese_name": "1-乙基-3-甲基咪唑四氟硼酸盐",
            "formula": "C6H11BF4N2",
            "aliases": [
                "[EMIM][BF4]", "[emim][bf4]", "EMIM BF4", "emim bf4",
                "1-ethyl-3-methylimidazolium tetrafluoroborate",
                "[C2MIM][BF4]", "[C2mim][BF4]",
            ],
            "patterns": [
                r'\[?emim\]?\s*\[?bf4\]?',
                r'\b1-ethyl-3-methylimidazolium\s+tetrafluoroborate\b',
            ]
        },
        "[EMIM][TFSI]": {
            "chinese_name": "1-乙基-3-甲基咪唑双(三氟甲烷磺酰)亚胺盐",
            "formula": "C8H11F6N3O4S2",
            "aliases": [
                "[EMIM][TFSI]", "[emim][tfsi]", "EMIM TFSI", "emim tfsi",
                "[EMIM][NTf2]", "[emim][ntf2]",
                "1-ethyl-3-methylimidazolium bis(trifluoromethylsulfonyl)imide",
                "1-ethyl-3-methylimidazolium TFSI",
            ],
            "patterns": [
                r'\[?emim\]?\s*\[?tfsi\]?',
                r'\[?emim\]?\s*\[?ntf2\]?',
                r'\b1-ethyl-3-methylimidazolium\s+bis\(trifluoromethylsulfonyl\)imide\b',
            ]
        },
        "[BMIM][TFSI]": {
            "chinese_name": "1-丁基-3-甲基咪唑双(三氟甲烷磺酰)亚胺盐",
            "formula": "C10H15F6N3O4S2",
            "aliases": [
                "[BMIM][TFSI]", "[bmim][tfsi]", "BMIM TFSI", "bmim tfsi",
                "[BMIM][NTf2]", "[bmim][ntf2]",
                "1-butyl-3-methylimidazolium bis(trifluoromethylsulfonyl)imide",
            ],
            "patterns": [
                r'\[?bmim\]?\s*\[?tfsi\]?',
                r'\[?bmim\]?\s*\[?ntf2\]?',
            ]
        },
        "[HMIM][PF6]": {
            "chinese_name": "1-己基-3-甲基咪唑六氟磷酸盐",
            "formula": "C10H19F6N2P",
            "aliases": [
                "[HMIM][PF6]", "[hmim][pf6]", "HMIM PF6",
                "1-hexyl-3-methylimidazolium hexafluorophosphate",
                "[C6MIM][PF6]",
            ],
            "patterns": [
                r'\[?hmim\]?\s*\[?pf6\]?',
                r'\b1-hexyl-3-methylimidazolium\s+hexafluorophosphate\b',
            ]
        },
        "[OMIM][PF6]": {
            "chinese_name": "1-辛基-3-甲基咪唑六氟磷酸盐",
            "formula": "C12H23F6N2P",
            "aliases": [
                "[OMIM][PF6]", "[omim][pf6]", "OMIM PF6",
                "1-octyl-3-methylimidazolium hexafluorophosphate",
                "[C8MIM][PF6]",
            ],
            "patterns": [
                r'\[?omim\]?\s*\[?pf6\]?',
                r'\b1-octyl-3-methylimidazolium\s+hexafluorophosphate\b',
            ]
        },
        
        # 吡啶类离子液体 (Pyridinium-based)
        "[BuPy][BF4]": {
            "chinese_name": "N-丁基吡啶四氟硼酸盐",
            "formula": "C9H14BF4N",
            "aliases": [
                "[BuPy][BF4]", "[bupy][bf4]", "BuPy BF4",
                "N-butylpyridinium tetrafluoroborate",
                "1-butylpyridinium tetrafluoroborate",
            ],
            "patterns": [
                r'\[?bupy\]?\s*\[?bf4\]?',
                r'\b[Nn]-butylpyridinium\s+tetrafluoroborate\b',
            ]
        },
        
        # 季铵盐类离子液体 (Ammonium-based)
        "[N4444][BTA]": {
            "chinese_name": "四丁基铵双(三氟甲烷磺酰)亚胺盐",
            "formula": "C20H36F6N2O4S2",
            "aliases": [
                "[N4444][BTA]", "[N4444][NTf2]", "[n4444][bta]",
                "tetrabutylammonium bis(trifluoromethylsulfonyl)imide",
                "[N4444][TFSI]",
            ],
            "patterns": [
                r'\[?n4444\]?\s*\[?(bta|ntf2|tfsi)\]?',
                r'\btetrabutylammonium\s+bis\(trifluoromethylsulfonyl\)imide\b',
            ]
        },
        
        # 季鏻盐类离子液体 (Phosphonium-based)
        "[P6,6,6,14][BTA]": {
            "chinese_name": "三己基十四烷基鏻双(三氟甲烷磺酰)亚胺盐",
            "formula": "C38H76F6NO4PS",
            "aliases": [
                "[P66614][BTA]", "[P66614][NTf2]", "[p66614][bta]",
                "trihexyl(tetradecyl)phosphonium bis(trifluoromethylsulfonyl)imide",
                "[P66614][TFSI]",
                "P66614 BTA", "P6,6,6,14][BTA]",
            ],
            "patterns": [
                r'\[?p6[,\s]*6[,\s]*6[,\s]*14\]?\s*\[?(bta|ntf2|tfsi)\]?',
                r'\btrihexyl\(tetradecyl\)phosphonium\b',
            ]
        },
        "[P6,6,6,14][BOB]": {
            "chinese_name": "三己基十四烷基鏻双(草酸根)硼酸盐",
            "formula": "C38H76BO4P",
            "aliases": [
                "[P66614][BOB]", "[p66614][bob]",
                "trihexyl(tetradecyl)phosphonium bis(oxalato)borate",
                "P66614 BOB", "[P6,6,6,14][BOB]",
            ],
            "patterns": [
                r'\[?p6[,\s]*6[,\s]*6[,\s]*14\]?\s*\[?bob\]?',
                r'\btrihexyl\(tetradecyl\)phosphonium\s+bis\(oxalato\)borate\b',
            ]
        },
        "[P6,6,6,14][BMB]": {
            "chinese_name": "三己基十四烷基鏻双(丙二酸根)硼酸盐",
            "formula": "C40H80BO4P",
            "aliases": [
                "[P66614][BMB]", "[p66614][bmb]",
                "trihexyl(tetradecyl)phosphonium bis(malonato)borate",
                "P66614 BMB", "[P6,6,6,14][BMB]",
            ],
            "patterns": [
                r'\[?p6[,\s]*6[,\s]*6[,\s]*14\]?\s*\[?bmb\]?',
            ]
        },
        "[P4,4,4,4][BTA]": {
            "chinese_name": "四丁基鏻双(三氟甲烷磺酰)亚胺盐",
            "formula": "C20H36F6NO4PS2",
            "aliases": [
                "[P4444][BTA]", "[p4444][bta]", "[P4444][NTf2]",
                "tetrabutylphosphonium bis(trifluoromethylsulfonyl)imide",
            ],
            "patterns": [
                r'\[?p4[,\s]*4[,\s]*4[,\s]*4\]?\s*\[?(bta|ntf2|tfsi)\]?',
            ]
        },
        
        # 吡咯烷类离子液体 (Pyrrolidinium-based)
        "[P14][TFSI]": {
            "chinese_name": "N-甲基-N-丙基吡咯烷双(三氟甲烷磺酰)亚胺盐",
            "formula": "C10H18F6N2O4S2",
            "aliases": [
                "[P14][TFSI]", "[P14][NTf2]", "[p14][tfsi]",
                "N-methyl-N-propylpyrrolidinium bis(trifluoromethylsulfonyl)imide",
                "[Py13][TFSI]", "[py13][tfsi]",
            ],
            "patterns": [
                r'\[?p14\]?\s*\[?(tfsi|ntf2)\]?',
                r'\b[Nn]-methyl-[Nn]-propylpyrrolidinium\b',
            ]
        },
        "[Pyr13][TFSI]": {
            "chinese_name": "N-甲基-N-丙基吡咯烷双(三氟甲烷磺酰)亚胺盐",
            "formula": "C10H18F6N2O4S2",
            "aliases": [
                "[Pyr13][TFSI]", "[pyr13][tfsi]",
                "N-methyl-N-propylpyrrolidinium TFSI",
            ],
            "patterns": [
                r'\[?pyr13\]?\s*\[?(tfsi|ntf2)\]?',
            ]
        },
        
        # 胍类离子液体 (Guanidinium-based)
        "[hC3C1C1][TFSI]": {
            "chinese_name": "N,N,N',N'-四甲基-N-丙基胍双(三氟甲烷磺酰)亚胺盐",
            "formula": "C10H20F6N4O4S2",
            "aliases": [
                "[hC3C1C1][TFSI]", "[hc3c1c1][tfsi]",
                "N,N,N',N'-tetramethyl-N-propylguanidinium TFSI",
            ],
            "patterns": [
                r'\[?hc3c1c1\]?\s*\[?(tfsi|ntf2)\]?',
            ]
        },
        
        # 吗啉类离子液体 (Morpholinium-based)
        "[MOR11][TFSI]": {
            "chinese_name": "N-甲基-N-乙基吗啉双(三氟甲烷磺酰)亚胺盐",
            "formula": "C9H16F6N2O5S2",
            "aliases": [
                "[MOR11][TFSI]", "[mor11][tfsi]",
                "N-methyl-N-ethylmorpholinium TFSI",
            ],
            "patterns": [
                r'\[?mor11\]?\s*\[?(tfsi|ntf2)\]?',
            ]
        },
        
        # 哌啶类离子液体 (Piperidinium-based)
        "[PIP14][TFSI]": {
            "chinese_name": "N-甲基-N-丁基哌啶双(三氟甲烷磺酰)亚胺盐",
            "formula": "C12H22F6N2O4S2",
            "aliases": [
                "[PIP14][TFSI]", "[pip14][tfsi]",
                "N-methyl-N-butylpiperidinium TFSI",
                "[Pip14][TFSI]",
            ],
            "patterns": [
                r'\[?pip14\]?\s*\[?(tfsi|ntf2)\]?',
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
            # 添加标准名称本身（多种大小写形式）
            self.alias_to_standard[standard_name.lower()] = standard_name
            self.alias_to_standard[standard_name.upper()] = standard_name
            
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
        
        # 3. 去除空格和方括号后的匹配
        normalized_input = term_clean.replace(" ", "").replace("[", "").replace("]", "").lower()
        for standard_name in self.STANDARD_TERMS.keys():
            normalized_standard = standard_name.replace(" ", "").replace("[", "").replace("]", "").lower()
            if normalized_input == normalized_standard:
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
    
    def get_formula(self, standard_term: str) -> Optional[str]:
        """
        获取标准术语的化学式
        
        Args:
            standard_term: 标准术语名称
            
        Returns:
            化学式，如果不存在则返回 None
        """
        if standard_term in self.STANDARD_TERMS:
            return self.STANDARD_TERMS[standard_term].get("formula")
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
il_kb = IonicLiquidKnowledgeBase()


def normalize_ionic_liquid(term: Optional[str]) -> Optional[str]:
    """
    便捷函数：标准化离子液体术语
    
    Args:
        term: 输入术语
        
    Returns:
        标准化后的术语
    """
    return il_kb.normalize(term)


def get_il_with_info(term: Optional[str]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    获取标准化术语及其中文名和化学式
    
    Args:
        term: 输入术语
        
    Returns:
        (标准术语, 中文名, 化学式) 元组
    """
    standard = il_kb.normalize(term)
    if standard:
        chinese = il_kb.get_chinese_name(standard)
        formula = il_kb.get_formula(standard)
        return standard, chinese, formula
    return term, None, None
