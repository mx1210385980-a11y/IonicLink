
import re
from typing import List, Optional, Tuple, Dict, Any
from knowledge_base import normalize_surface, normalize_ionic_liquid

def normalize_temperature(text: Optional[str]) -> Optional[str]:
    """
    Normalize temperature strings to Kelvin (K).
    Handles: "30°C", "30 C", "303 K", "Room Temperature", "Ambient".
    """
    if not text:
        return None
        
    text_clean = text.strip().lower()
    
    # 1. Handle common text descriptions
    if any(x in text_clean for x in ['room', 'ambient', 'rt']):
        return "298.15 K"
        
    # 2. Extract number using regex
    # Match numbers, optional negative sign, optional decimals
    match = re.search(r'([-+]?\d*\.?\d+)', text_clean)
    if not match:
        return text  # Return original if no number found
        
    try:
        value = float(match.group(1))
    except ValueError:
        return text

    # 3. Detect Unit and Convert
    # If explicitly Kelvin
    if 'k' in text_clean and 'c' not in text_clean: 
        return f"{value:.2f} K"
    
    # If explicitly Celsius or implied Celsius (common assumption if unit missing and val < 200)
    # Note: Scientists rarely write < 200 K without explicit unit, but often write "25" for 25°C
    is_celsius = 'c' in text_clean or '°' in text_clean or value < 200
    
    if is_celsius:
        kelvin_val = value + 273.15
        return f"{kelvin_val:.2f} K"
    
    # Default fallback (assume already Kelvin if > 200 and no unit)
    return f"{value:.2f} K"


def parse_value_with_unit(text: str) -> Tuple[Optional[float], Optional[str]]:
    """从带单位的字符串中提取数值和单位
    
    Args:
        text: 带单位的字符串，如 "55 nN", "1.1 mN"
    
    Returns:
        (value, unit) 元组，如果解析失败返回 (None, None)
    """
    if not text or not isinstance(text, str):
        return None, None
    
    # 匹配数字（包括小数和科学计数法）和单位
    pattern = r'([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s*([a-zA-Zμµ]+)?'
    match = re.search(pattern, text.strip())
    
    if match:
        try:
            value = float(match.group(1))
            unit = match.group(2) if match.group(2) else None
            return value, unit
        except (ValueError, AttributeError):
            return None, None
    
    return None, None


def normalize_force_to_newtons(value: float, unit: str) -> Optional[float]:
    """将力值转换为牛顿 (N)
    
    Args:
        value: 数值
        unit: 单位 (nN, µN, uN, mN, N)
    
    Returns:
        转换后的牛顿值，如果单位未识别返回 None
    """
    if not unit:
        return value  # 假设无单位就是牛顿
    
    unit_lower = unit.lower()
    
    # 单位转换表
    conversions = {
        'nn': 1e-9,   # 纳牛
        'µn': 1e-6,   # 微牛 (希腊字母 µ)
        'μn': 1e-6,   # 微牛 (替代符号)
        'un': 1e-6,   # 微牛 (u 替代)
        'mn': 1e-3,   # 毫牛
        'n': 1.0,     # 牛顿
    }
    
    if unit_lower in conversions:
        return value * conversions[unit_lower]
    
    return None  # 未识别的单位


def calculate_missing_cof(data_items: List[dict]) -> List[dict]:
    """计算缺失的摩擦系数
    
    对于每条记录：
    1. 如果 cof 缺失但 friction_force 和 normal_load 存在，则计算 COF
    2. 标记数据来源为 'extracted' 或 'calculated'
    
    Args:
        data_items: 数据记录列表
    
    Returns:
        处理后的数据记录列表
    """
    for item in data_items:
        # 检查 cof 是否缺失
        cof_missing = (
            'cof' not in item or 
            item['cof'] is None or 
            item['cof'] == '' or 
            item['cof'] == '-'
        )
        
        # 检查是否有 friction_force 和 normal_load
        has_friction = 'friction_force' in item and item['friction_force']
        has_load = 'normal_load' in item and item['normal_load']
        
        if cof_missing and has_friction and has_load:
            # 尝试计算 COF
            friction_val, friction_unit = parse_value_with_unit(str(item['friction_force']))
            load_val, load_unit = parse_value_with_unit(str(item['normal_load']))
            
            if friction_val is not None and load_val is not None:
                # 转换为统一单位 (牛顿)
                friction_n = normalize_force_to_newtons(friction_val, friction_unit)
                load_n = normalize_force_to_newtons(load_val, load_unit)
                
                if friction_n is not None and load_n is not None and load_n != 0:
                    # 计算摩擦系数
                    calculated_cof = friction_n / load_n
                    item['cof'] = str(round(calculated_cof, 6))  # 保留6位小数
                    item['value_origin'] = 'calculated'
                    print(f"计算 COF: {item['friction_force']} / {item['normal_load']} = {item['cof']}")
        
        # 如果 COF 是提取的，标记为 extracted
        elif not cof_missing:
            if 'value_origin' not in item or not item['value_origin']:
                item['value_origin'] = 'extracted'
    
    return data_items


def set_default_temperature(data_items: List[dict]) -> List[dict]:
    """为未指明温度的数据设置默认值
    
    Args:
        data_items: 数据记录列表
    
    Returns:
        处理后的数据记录列表
    """
    for item in data_items:
        # 检查温度是否缺失或为空
        if 'temperature' not in item or item['temperature'] is None or item['temperature'] == '' or item['temperature'] == '-':
            # 设置默认温度为298.15K (室温)
            item['temperature'] = '298.15 K'
    
    return data_items


def normalize_surface_terms(data_items: List[dict]) -> List[dict]:
    """标准化表面材料术语
    
    使用表面材料知识库将 material_name 字段标准化为统一术语。
    支持的标准术语：Mica, HOPG, Au(111), Silica, Stainless steel, Titanium
    
    Args:
        data_items: 数据记录列表
    
    Returns:
        处理后的数据记录列表
    """
    for item in data_items:
        # 标准化 material_name 字段
        if 'material_name' in item and item['material_name']:
            original = item['material_name']
            normalized = normalize_surface(original)
            if normalized and normalized != original:
                item['material_name'] = normalized
                print(f"[Surface Normalization] material_name: '{original}' -> '{normalized}'")
    
    return data_items


def normalize_ionic_liquid_terms(data_items: List[dict]) -> List[dict]:
    """标准化离子液体术语
    
    使用离子液体知识库将 ionic_liquid 字段标准化为统一术语。
    
    Args:
        data_items: 数据记录列表
    
    Returns:
        处理后的数据记录列表
    """
    for item in data_items:
        # 标准化 ionic_liquid 字段
        if 'ionic_liquid' in item and item['ionic_liquid']:
            original = item['ionic_liquid']
            normalized = normalize_ionic_liquid(original)
            if normalized and normalized != original:
                item['ionic_liquid'] = normalized
                print(f"[IL Normalization] ionic_liquid: '{original}' -> '{normalized}'")
    
    return data_items
