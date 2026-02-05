"""
Unit Converter Service for IonicLink
将前端传来的字符串解析为标准化数值

支持的单位转换：
- 力: nN, µN, μN, mN, N → Newtons
- 速度: mm/s, cm/s, m/s, rpm → m/s
- COF: 解析操作符 <, >, ≤, ≥, ~
"""

import re
from typing import Tuple, Optional
from enum import Enum


class ComparisonOperator(str, Enum):
    """比较操作符"""
    EQ = "EQ"  # 等于
    LT = "LT"  # 小于
    GT = "GT"  # 大于
    LE = "LE"  # 小于等于
    GE = "GE"  # 大于等于


# 力单位转换因子 (转换为 Newtons)
FORCE_UNITS = {
    'nn': 1e-9,      # nanoNewtons
    'un': 1e-6,      # microNewtons (µN)
    'μn': 1e-6,      # microNewtons (alternate)
    'µn': 1e-6,      # microNewtons (alternate)
    'mn': 1e-3,      # milliNewtons
    'n': 1.0,        # Newtons
    'kn': 1e3,       # kiloNewtons
}

# 速度单位转换因子 (转换为 m/s)
SPEED_UNITS = {
    'nm/s': 1e-9,    # nanometers per second
    'um/s': 1e-6,    # micrometers per second
    'μm/s': 1e-6,    # micrometers per second
    'µm/s': 1e-6,    # micrometers per second
    'mm/s': 1e-3,    # millimeters per second
    'cm/s': 1e-2,    # centimeters per second
    'm/s': 1.0,      # meters per second
    'km/h': 1/3.6,   # kilometers per hour
}


def parse_force_to_newtons(raw: Optional[str]) -> Optional[float]:
    """
    将力/载荷字符串解析为 Newtons
    
    Examples:
        '55 nN' → 5.5e-8
        '1.2 mN' → 0.0012
        '5 N' → 5.0
        '100' → 100.0 (假设单位为 N)
    
    Args:
        raw: 原始字符串，如 "55 nN"
    
    Returns:
        标准化后的数值 (Newtons)，如果解析失败返回 None
    """
    if not raw or not raw.strip():
        return None
    
    raw = raw.strip().lower()
    
    # 匹配数值和单位: 可选符号 + 数值 + 可选空格 + 可选单位
    pattern = r'^([<>≤≥~±]?\s*)?([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-zμµ/]+)?$'
    match = re.match(pattern, raw)
    
    if not match:
        return None
    
    _, value_str, unit = match.groups()
    
    try:
        value = float(value_str)
    except ValueError:
        return None
    
    # 如果没有单位，假设是 Newtons
    if not unit:
        return value
    
    # 查找转换因子
    unit_lower = unit.lower()
    for unit_key, factor in FORCE_UNITS.items():
        if unit_lower == unit_key:
            return value * factor
    
    # 未识别的单位，返回原始值
    return value


def parse_speed_to_mps(raw: Optional[str]) -> Optional[float]:
    """
    将速度字符串解析为 m/s
    
    Examples:
        '100 mm/s' → 0.1
        '1.5 m/s' → 1.5
        '10 cm/s' → 0.1
    
    Note:
        rpm 需要知道半径才能转换，暂不支持自动转换
    
    Args:
        raw: 原始字符串，如 "100 mm/s"
    
    Returns:
        标准化后的数值 (m/s)，如果解析失败返回 None
    """
    if not raw or not raw.strip():
        return None
    
    raw = raw.strip().lower()
    
    # 匹配数值和单位
    pattern = r'^([<>≤≥~±]?\s*)?([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-zμµ/]+)?$'
    match = re.match(pattern, raw)
    
    if not match:
        return None
    
    _, value_str, unit = match.groups()
    
    try:
        value = float(value_str)
    except ValueError:
        return None
    
    # 如果没有单位，假设是 m/s
    if not unit:
        return value
    
    # 查找转换因子
    unit_lower = unit.lower()
    for unit_key, factor in SPEED_UNITS.items():
        if unit_lower == unit_key:
            return value * factor
    
    # rpm 特殊处理 - 返回 None 表示需要手动转换
    if 'rpm' in unit_lower:
        return None
    
    # 未识别的单位，返回原始值
    return value


def parse_cof_value(raw: Optional[str]) -> Tuple[Optional[float], ComparisonOperator]:
    """
    解析摩擦系数字符串，提取数值和比较操作符
    
    Examples:
        '< 0.02' → (0.02, 'LT')
        '> 0.1' → (0.1, 'GT')
        '≤ 0.05' → (0.05, 'LE')
        '0.15' → (0.15, 'EQ')
        '~ 0.08' → (0.08, 'EQ')  # 约等于视为等于
    
    Args:
        raw: 原始字符串，如 "< 0.02"
    
    Returns:
        (数值, 操作符) 元组
    """
    if not raw or not raw.strip():
        return None, ComparisonOperator.EQ
    
    raw = raw.strip()
    
    # 定义操作符映射
    operator_map = {
        '<': ComparisonOperator.LT,
        '>': ComparisonOperator.GT,
        '≤': ComparisonOperator.LE,
        '<=': ComparisonOperator.LE,
        '≥': ComparisonOperator.GE,
        '>=': ComparisonOperator.GE,
        '~': ComparisonOperator.EQ,  # 约等于
        '±': ComparisonOperator.EQ,  # 误差表示
        '≈': ComparisonOperator.EQ,  # 约等于
    }
    
    # 匹配操作符和数值
    pattern = r'^([<>≤≥~±≈]|<=|>=)?\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)'
    match = re.match(pattern, raw)
    
    if not match:
        return None, ComparisonOperator.EQ
    
    operator_str, value_str = match.groups()
    
    try:
        value = float(value_str)
    except ValueError:
        return None, ComparisonOperator.EQ
    
    # 确定操作符
    operator = ComparisonOperator.EQ
    if operator_str:
        operator = operator_map.get(operator_str, ComparisonOperator.EQ)
    
    return value, operator


def parse_and_normalize(raw: Optional[str], field_type: str) -> Tuple[Optional[float], Optional[str]]:
    """
    通用解析函数，返回标准化数值和操作符
    
    Args:
        raw: 原始字符串
        field_type: 字段类型 ('force', 'speed', 'cof')
    
    Returns:
        (标准化数值, 操作符字符串 or None)
    """
    if field_type == 'force':
        value = parse_force_to_newtons(raw)
        return value, None
    elif field_type == 'speed':
        value = parse_speed_to_mps(raw)
        return value, None
    elif field_type == 'cof':
        value, operator = parse_cof_value(raw)
        return value, operator.value
    else:
        return None, None
