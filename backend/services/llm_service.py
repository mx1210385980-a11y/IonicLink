import os
import json
import re
import asyncio
from typing import List, Optional
from openai import OpenAI
from dotenv import load_dotenv
from models.tribology import TribologyData
from services.doi_service import DOIService
from services.score_service import calculate_confidence

load_dotenv()


def parse_value_with_unit(text: str) -> tuple[Optional[float], Optional[str]]:
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
            item['temperature'] = '298.15K'
    
    return data_items


class LLMService:
    """LLM服务，用于从文献中提取摩擦学数据"""
    
    def __init__(self):
        self.client = OpenAI(
            api_key=os.getenv("OPENAI_API_KEY", ""),
            base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            timeout=120.0  # 120秒超时，防止处理长PDF时超时
        )
        self.model = os.getenv("LLM_MODEL", "gpt-4o-mini")

    
    def extract_tribology_data(self, content: str) -> List[TribologyData]:
        """从文献内容中提取摩擦学数据"""
        
        prompt = """你是一个专业的摩擦学数据提取助手。请从以下文献内容中提取所有离子液体润滑相关的实验数据。

对于每条数据记录，请提取以下字段：
- material_name: 材料名称（摩擦副材料）
- ionic_liquid: 离子液体名称/类型
- base_oil: 基础油（如有）
- concentration: 离子液体浓度（如有）
- load: 载荷（单位：N）
- speed: 速度（单位：mm/s 或 rpm）
- temperature: 温度（单位：°C）
- cof: 摩擦系数 (COF，数值或包含特殊符号如 '<0.01')
- friction_force: 摩擦力（带单位，如 '1.1 nN', '5 mN'）**即使COF已给出也要提取**
- normal_load: 法向载荷（带单位，如 '55 nN', '10 N'）**即使COF已给出也要提取**
- wear_rate: 磨损率（如有）
- test_duration: 测试时间（如有）
- contact_type: 接触类型（如 ball-on-disk, pin-on-disk 等）
- potential: 电化学电势/电压（如 '+1.5V', '-1.0V', 'OCP'）。如果是开路电位，填写 'OCP'。务必保留正负号。
- water_content: 离子液体中的含水量（如 '50 ppm', '100 ppm'）或环境湿度（如 'RH 50%'）。如果明确为干燥环境，填写 'Dry'。
- surface_roughness: 接触表面的粗糙度参数（如 'RMS 4.9 nm', 'Ra 0.1 nm'）。
- source: 数据来源（表格编号或章节）
- notes: 其他重要备注

**关键规则 (Critical Rules):**
1. 如果文中明确给出了数值，直接提取该数值。
2. 如果文中没有明确数值，但存在对比性描述（例如："lowest friction", "lower than IL-0%", "higher than"），请基于被比较对象的数值推断出一个不等式区间（如 "< 0.02" 或 "> 0.05"）。
3. 必须检查相关图表的文字描述（如 "slope of friction vs load", "Figure 3 shows..."），从中提取数值信息。
4. 对于不等式范围，使用标准符号：< (小于), > (大于), ≤ (小于等于), ≥ (大于等于)。
5. **记录分割规则 (Record Splitting)**: 如果实验比较了不同的 potential 条件（如 "Friction was 0.01 at +1.5V and 0.1 at -1.0V"），必须生成**两条独立记录**：
   - 记录1: { "cof": "0.01", "potential": "+1.5V", ... }
   - 记录2: { "cof": "0.1", "potential": "-1.0V", ... }
   其他条件变量（water_content, temperature 等）也适用同样规则。

**示例推理过程 (Example Thinking Process):**

原文示例: "IL-44% has a COF of 0.04. The PEG-IL system exhibits the lowest friction coefficient. Pure IL shows a COF of 0.02."

推理:
- IL-44% 的 COF 明确给出：0.04
- PEG-IL 的 COF 没有直接给出，但描述为 "lowest friction coefficient"（最低摩擦系数）
- 已知数值：IL-44% = 0.04, Pure IL = 0.02
- 既然 PEG-IL 是"最低"，它应该小于所有已知数值中的最小值
- 输出：PEG-IL 的 cof 字段应填写 "< 0.02"

另一个示例: "The modified surface showed significantly lower COF compared to baseline (COF = 0.15)."

推理:
- 基准值 (baseline) 的 COF 明确给出：0.15
- 改性表面的 COF 描述为 "significantly lower"（显著更低）
- 输出：改性表面的 cof 字段应填写 "< 0.15"

请以JSON数组格式返回提取的数据，每条记录为一个对象。如果某字段无法从文献中获取，设为null。

文献内容：
"""
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "你是一个专业的摩擦学数据提取助手，擅长从科学文献中提取结构化数据。"},
                    {"role": "user", "content": prompt + content}
                ],
                response_format={"type": "json_object"},
                temperature=0.1
            )
            
            result = json.loads(response.choices[0].message.content)
            
            # 处理返回结果可能的不同格式
            if isinstance(result, list):
                data_list = result
            elif "data" in result:
                data_list = result["data"]
            elif "records" in result:
                data_list = result["records"]
            else:
                data_list = [result]
            
            # 字段名列表，这些字段应该是字符串类型
            string_fields = ['load', 'speed', 'temperature', 'cof', 'wear_rate', 
                           'test_duration', 'concentration', 'base_oil', 'contact_type',
                           'material_name', 'ionic_liquid', 'source', 'notes', 
                           'friction_force', 'normal_load', 'value_origin',
                           'potential', 'water_content', 'surface_roughness']
            
            # 将数值类型转换为字符串
            converted_data = []
            for item in data_list:
                if item:
                    for field in string_fields:
                        if field in item and item[field] is not None:
                            # 如果是数字类型，转换为字符串
                            if isinstance(item[field], (int, float)):
                                item[field] = str(item[field])
                    converted_data.append(item)
            
            # 计算缺失的摩擦系数
            converted_data = calculate_missing_cof(converted_data)
            
            # 为未指明温度的数据设置默认值
            converted_data = set_default_temperature(converted_data)
            
            return [TribologyData(**item) for item in converted_data]
            
        except Exception as e:
            print(f"LLM提取错误: {e}")
            return []
    
    # ========== Pass 1: 元数据提取 (仅首页) ==========
    def _extract_metadata_only(self, content: str) -> dict:
        """从文献首页提取元数据 (仅使用前4000字符)
        
        Args:
            content: 完整文献内容
            
        Returns:
            dict: { title, authors, doi, journal, issn, year, volume, issue, pages }
        """
        # 只看前4000字符 (通常包含标题页和版权信息)
        header_content = content[:4000]
        
        system_prompt = """You are a Scientific Librarian. Your ONLY task is to extract paper identity from the header/first-page text.

**Output JSON Format**:
{
  "title": "Full paper title (string)",
  "authors": "Author names, comma-separated (string)",
  "doi": "DOI in 10.xxxx/... format, or empty string if not found",
  "journal": "Journal name (string)",
  "issn": "ISSN or null",
  "year": Publication year (integer or null),
  "volume": "Volume number or null",
  "issue": "Issue number or null",
  "pages": "Page range like '123-145' or null"
}

**Rules**:
1. Look for DOI near copyright info, header, or footer.
2. If DOI is NOT found, return empty string "", NOT null.
3. Year must be an integer (e.g., 2024) or null if not found.
4. Authors should be comma-separated (e.g., "John Smith, Jane Doe").
5. **Header Analysis**: Look for standard citation headers like "Journal Vol(Issue): Pages (Year)".
   Example: "Friction 10(2): 268-281 (2022)" -> Journal=Friction, Vol=10, Issue=2, Pages=268-281, Year=2022."""

        user_prompt = f"Extract metadata from this paper header:\n\n{header_content}"
        
        default_metadata = {
            "title": "",
            "authors": "",
            "doi": "",
            "journal": "",
            "issn": None,
            "year": None,  # Don't default to 2024 - let it be null if not extracted
            "volume": None,
            "issue": None,
            "pages": None
        }
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.1,
                timeout=30  # 元数据提取应该很快
            )
            
            result = json.loads(response.choices[0].message.content)
            
            # 填充缺失字段
            for key, default_val in default_metadata.items():
                if key not in result or result[key] is None:
                    result[key] = default_val
            
            # 确保 year 是 int 或 None
            if isinstance(result.get("year"), str):
                try:
                    result["year"] = int(result["year"])
                except:
                    result["year"] = None  # Don't default to 2024
            
            return result
            
        except Exception as e:
            print(f"[Pass 1] 元数据提取错误: {e}")
            return default_metadata

    # ========== 主入口: 双通道提取 ==========
    async def extract_with_metadata(self, content: str) -> dict:
        """从文献中同时提取元数据和摩擦学数据 (双通道策略 + DOI Enrichment)
        
        使用 Two-Pass Extraction Strategy:
        - Pass 1: 从首页提取元数据（快速，仅4000字符）
        - Pass 1.5: 如果提取到 DOI，使用 Crossref API 获取权威元数据
        - Pass 2: 从全文提取摩擦学数据（使用原始高性能 Prompt）
        
        Args:
            content: 完整文献内容
            
        Returns:
            dict: {
                "metadata": { title, doi, authors, journal, year, ... },
                "data": [ TribologyData, ... ]  # 注意: 改为 "data" 以匹配前端期望
            }
        """
        print("[Two-Pass Extraction] Starting Pass 1: Metadata extraction (first 4000 chars)...")
        llm_metadata = self._extract_metadata_only(content)
        print(f"[Two-Pass Extraction] Pass 1 complete. Title: {llm_metadata.get('title', 'N/A')[:50]}...")
        
        # Pass 1.5: DOI Enrichment - 使用 Crossref 获取权威元数据
        final_metadata = llm_metadata.copy()
        doi_str = llm_metadata.get('doi', '')
        
        if doi_str and doi_str.strip():
            print(f"[Two-Pass Extraction] Pass 1.5: Resolving DOI via Crossref: {doi_str}")
            try:
                doi_service = DOIService()
                crossref_metadata = await doi_service.resolve_doi(doi_str)
                
                if crossref_metadata:
                    print(f"[Two-Pass Extraction] Crossref metadata found. Title: {crossref_metadata.title[:50] if crossref_metadata.title else 'N/A'}...")
                    # 使用 Crossref 权威数据覆盖 LLM 提取的数据
                    final_metadata = {
                        "title": crossref_metadata.title or llm_metadata.get("title", ""),
                        "authors": crossref_metadata.authors or llm_metadata.get("authors", ""),
                        "doi": crossref_metadata.doi,  # 使用标准化后的 DOI
                        "journal": crossref_metadata.journal or llm_metadata.get("journal", ""),
                        "issn": crossref_metadata.issn or llm_metadata.get("issn"),
                        "year": crossref_metadata.year or llm_metadata.get("year"),
                        "volume": crossref_metadata.volume or llm_metadata.get("volume"),
                        "issue": crossref_metadata.issue or llm_metadata.get("issue"),
                        "pages": crossref_metadata.pages or llm_metadata.get("pages")
                    }
                else:
                    print("[Two-Pass Extraction] Crossref resolution failed, using LLM metadata")
            except Exception as e:
                print(f"[Two-Pass Extraction] DOI resolution error: {e}, using LLM metadata")
        else:
            print("[Two-Pass Extraction] No DOI found, skipping Crossref enrichment")
        
        print("[Two-Pass Extraction] Starting Pass 2: Tribology data extraction (full content)...")
        records = self.extract_tribology_data(content)  # 复用原始高性能方法
        print(f"[Two-Pass Extraction] Pass 2 complete. Records: {len(records)}")
        
        # 转换 TribologyData 对象为字典，确保前端可以正确处理
        records_dict = []
        for record in records:
            record_data = {
                "material_name": record.material_name,
                "ionic_liquid": record.ionic_liquid,
                "base_oil": record.base_oil,
                "concentration": record.concentration,
                "load": record.load,
                "speed": record.speed,
                "temperature": record.temperature,
                "cof": record.cof,
                "wear_rate": record.wear_rate,
                "test_duration": record.test_duration,
                "contact_type": record.contact_type,
                "potential": record.potential,
                "water_content": record.water_content,
                "surface_roughness": record.surface_roughness,
                "source": record.source,
                "notes": record.notes,
                "friction_force": record.friction_force,
                "normal_load": record.normal_load,
                "value_origin": record.value_origin
            }
            # Apply dynamic confidence scoring
            confidence_score = calculate_confidence(record_data)
            record_data["confidence"] = confidence_score
            print(f"[Dynamic Confidence] material={record.material_name[:30] if record.material_name else 'N/A'}, score={confidence_score}")
            records_dict.append(record_data)
        
        print(f"[Two-Pass Extraction] Applied dynamic confidence to {len(records_dict)} records")
        
        return {
            "metadata": final_metadata,
            "data": records_dict  # 使用 "data" 匹配前端期望的字段名
        }
    
    def chat(self, message: str, context: Optional[str] = None) -> str:
        """与用户进行对话"""
        
        system_prompt = """你是IonicLink文献数据提取助手，专注于离子液体润滑领域的文献分析。

你可以帮助用户：
1. 上传和解析PDF/文本文献
2. 自动提取摩擦学实验数据
3. 解答离子液体润滑相关的学术问题
4. 分析和比较提取的数据

请用专业但友好的语调回复用户。"""
        
        messages = [{"role": "system", "content": system_prompt}]
        
        if context:
            messages.append({"role": "user", "content": f"当前文献内容参考：\n{context[:2000]}..."})
        
        messages.append({"role": "user", "content": message})
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"抱歉，处理请求时出现错误：{str(e)}"


# 创建全局实例
llm_service = LLMService()
