import os
import json
import re
import asyncio
from typing import List, Optional
from openai import AsyncOpenAI
import base64
from pathlib import Path
from dotenv import load_dotenv
from models.tribology import TribologyData
from services.doi_service import DOIService
from services.score_service import calculate_confidence
from services.cleaning_service import (
    normalize_temperature, 
    set_default_temperature,
    normalize_surface_terms,
    normalize_ionic_liquid_terms
)


load_dotenv(override=True)





import io
from PIL import Image

class LLMService:
    """LLM服务，用于从文献中提取摩擦学数据"""
    
    def __init__(self):
        # Base Configuration
        self.base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        self.default_api_key = os.getenv("OPENAI_API_KEY", "")
        
        # Dual Model Configuration
        # Claude 3.5 Sonnet for vision extraction (high quality for scientific images)
        self.vision_model = os.getenv("LLM_VISION_MODEL", "claude-3-5-sonnet-20241022")
        self.text_model = os.getenv("LLM_TEXT_MODEL", "gemini-3-flash-preview")
        self.vision_api_key = os.getenv("LLM_VISION_API_KEY", self.default_api_key)
        
        # Legacy fallback
        self.default_model = os.getenv("LLM_MODEL", "claude-3-5-sonnet-20241022")
        
        # Initialize Separate Clients
        # 1. Vision Client (Uses dedicated Vision Key if available)
        # 1. Vision Client (Uses dedicated Vision Key if available)
        self.vision_client = AsyncOpenAI(
            api_key=self.vision_api_key,
            base_url=self.base_url,
            timeout=180.0
        )
        
        # 2. Text Client (Uses default Key)
        self.text_client = AsyncOpenAI(
            api_key=self.default_api_key,
            base_url=self.base_url,
            timeout=120.0 # Shorter timeout for text
        )
        
        print(f"[LLM Config] Vision Model: {self.vision_model} (Claude 3.5 Sonnet)")
        print(f"[LLM Config] Text Model: {self.text_model} (Claude 3.5 Sonnet)")

    async def _process_batch(self, batch_idx: int, total_batches: int, batch_images: List[str], content: str, base_prompt: str) -> List[dict]:
        """Process a single batch of images with the LLM"""
        try:
            print(f"[LLM Service] --- Starting Batch {batch_idx + 1}/{total_batches} ---")
            
            # Anti-hallucination System Prompt
            system_prompt = "You are a scientific data extraction assistant. extracting data from charts strictly. If the resolution is too low or data is unclear, explicitly output 'null' instead of guessing numbers. Do not hallucinate."
            
            messages = [
                {"role": "system", "content": system_prompt}
            ]
            
            user_content = []
            
            # 1. Add text instructions + content
            user_content.append({"type": "text", "text": base_prompt + content})
            
            # 2. Add Images for this batch
            if batch_images:
                for i, img_input in enumerate(batch_images):
                    # Use strictly prepared image string (Path or Base64) with Compression
                    image_data_url = self._prepare_image_input(img_input)
                    if image_data_url:
                        user_content.append({
                            "type": "image_url", 
                            "image_url": {
                                "url": image_data_url
                            }
                        })
                    else:
                        print(f"[LLM Service] Skipping corrupt image input in batch {batch_idx + 1}")
            
            messages.append({"role": "user", "content": user_content})

            try:
                # Call LLM (Primary: Claude 3.5 Sonnet or configured model)
                response = await self.vision_client.chat.completions.create(
                    model=self.vision_model, 
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.0 # Strict deterministic output
                )
            except Exception as e:
                print(f"[LLM Service] Primary model {self.vision_model} failed for batch {batch_idx + 1}: {e}")
                if "model_not_found" in str(e) or "404" in str(e) or "400" in str(e):
                    print(f"[LLM Service] Switching to fallback model: gpt-4o for batch {batch_idx + 1}")
                    response = await self.vision_client.chat.completions.create(
                        model="claude-3-5-sonnet-20241022", 
                        messages=messages,
                        response_format={"type": "json_object"},
                        temperature=0.0
                    )
                else:
                    raise e # Re-raise if it's not a model availability issue
            
            response_text = response.choices[0].message.content
            return self._parse_json_response(response_text)
            
        except Exception as e:
            print(f"[LLM Service] Error in Batch {batch_idx + 1}: {e}")
            return []

    def _clean_json_string(self, text: str) -> str:
        """Robustly clean JSON string using Regex and finding brackets"""
        # 1. Try to extract markdown code block
        match = re.search(r"```(?:json)?\s*(.*)\s*```", text, re.DOTALL)
        if match:
            return match.group(1).strip()
        
        # 2. Determine if it looks like a list or a dict by finding the first occurrence
        idx_list = text.find('[')
        idx_dict = text.find('{')
        
        # If neither found, return original
        if idx_list == -1 and idx_dict == -1:
            return text
            
        # If both exist, pick the one that appears first (outermost container)
        if idx_list != -1 and (idx_dict == -1 or idx_list < idx_dict):
            # It starts with [, likely a list
            end_list = text.rfind(']')
            if end_list != -1:
                return text[idx_list:end_list+1]
        else:
            # It starts with {, likely a dict
            end_dict = text.rfind('}')
            if end_dict != -1:
                return text[idx_dict:end_dict+1]
                
        return text

    def _parse_json_response(self, response_text: str) -> List[dict]:
        """Robustly parse JSON response, stripping Markdown if present"""
        try:
            # Use robust cleaner
            clean_text = self._clean_json_string(response_text)
            
            result = json.loads(clean_text)
            
            # Normalize result format
            if isinstance(result, list):
                return result
            elif "data" in result:
                return result["data"]
            elif "records" in result:
                return result["records"]
            else:
                return [result]
                
        except json.JSONDecodeError as e:
            print(f"[LLM Service] JSON Parse Error: {e}")
            print(f"[LLM Service] JSON Parse Error: {e}")
            print(f"[LLM Service] Raw Response: {response_text[:500]}...") # Log first 500 chars
            print(f"[LLM Service] Cleaned Text (Failed): {clean_text[:500]}...")
            return []
        except Exception as e:
             print(f"[LLM Service] Unexpected Parsing Error: {e}")
             return []

    def _prepare_image_input(self, image_input: str) -> Optional[str]:
        """
        Prepare image input for LLM with COMPRESSION.
        Accepts either a local file path or a base64 data URI.
        Returns a sanitized and compressed base64 data URI string.
        """
        if not image_input:
            return None
            
        try:
            img_data = None
            
            # Case 1: Already a Base64 Data URI
            if image_input.startswith("data:image"):
                # Extract actual base64 data
                header, encoded = image_input.split(",", 1)
                img_data = base64.b64decode(encoded)
            
            # Case 2: File Path (Legacy support / Fallback)
            elif os.path.exists(image_input):
                 with open(image_input, "rb") as image_file:
                    img_data = image_file.read()
            else:
                print(f"[LLM Service] Image input not found or invalid: {str(image_input)[:50]}...")
                return None

            if not img_data:
                return None

            # Process with Pillow (Resize & Compress)
            with Image.open(io.BytesIO(img_data)) as pil_img:
                # Force RGB
                if pil_img.mode != 'RGB':
                    pil_img = pil_img.convert('RGB')
                
                # Resize if too large (Max 1024x1024)
                MAX_SIZE = (1024, 1024)
                pil_img.thumbnail(MAX_SIZE)
                
                # Save as compressed JPEG
                output_buffer = io.BytesIO()
                pil_img.save(output_buffer, format='JPEG', quality=70) # 70% Quality
                
                # Get Base64
                b64_str = base64.b64encode(output_buffer.getvalue()).decode('utf-8')
                
                # Return strict formatted string
                return f"data:image/jpeg;base64,{b64_str}"
                
        except Exception as e:
            print(f"[LLM Service] Image processing/compression failed: {e}")
            return None

    def _is_valid_numeric_entry(self, value: str) -> bool:
        """
        Check if a value string contains valid numeric content.
        Reject long descriptions or qualitative text.
        """
        if not value:
            return False
        val_str = str(value).strip()
        
        # 1. Reject long descriptions (e.g., > 20 chars is suspicious for a simple number)
        # Exception: "0.01 +/- 0.002" is okay, but descriptions are usually long.
        if len(val_str) > 20: 
            return False
            
        # 2. Reject words indicating descriptions
        # Using a list of common qualitative words
        forbidden_words = ['increase', 'decrease', 'depend', 'versus', 'function', 'correla', 'high', 'low', 'vary', 'varies']
        if any(word in val_str.lower() for word in forbidden_words):
            return False

        # 3. Must contain at least one digit
        if not re.search(r'\d', val_str):
            return False
            
        return True

    def _sanitize_numeric_string(self, value: str) -> str | None:
        """
        Returns the string only if it starts with a number.
        Examples: "298 K" -> "298 K", "Room Temp" -> None
        Also handles ranges (e.g., "0.5-250") and rejects overly long strings.
        """
        if not value:
            return None
        s = str(value).strip()
        
        # Reject overly long strings to prevent "paragraph extraction"
        if len(s) > 50:
            return None
        
        # Regex: Must start with a digit (or minus sign for potential)
        # Also ensure it contains at least one digit somewhere
        if re.match(r'^-?\d', s) and re.search(r'\d', s):
            return s
        return None

    def _sanitize_potential(self, value: str) -> str | None:
        """
        Special sanitizer for electrochemical potentials.
        Accepts: "+1.5 V", "-0.5V", "OCP", "0 V".
        """
        if not value: return None
        s = str(value).strip()
        
        # 1. Allow specific keywords
        if any(x in s.upper() for x in ["OCP", "OPEN", "CIRCUIT"]):
            return "OCP"
            
        # 2. Allow leading + or - followed by digits
        # Matches: "+1.5", "-0.2", "0.5"
        if re.match(r'^[+-]?\d', s):
            return s
            
        return None

    def _sanitize_cof(self, value: str) -> float | None:
        """
        Strictly converts COF to float AND checks physical bounds.
        """
        if not value: 
            return None
        try:
            # 1. Regex to find the first valid float number
            # Support scientific notation like 1e-3
            match = re.search(r'-?\d+(\.\d+)?([eE][-+]?\d+)?', str(value))
            if not match:
                return None
            
            val_float = float(match.group(0))
            
            # 2. SANITY CHECK: Friction Coefficient must be physically reasonable
            # COF is rarely > 5.0 (even seizure) and rarely < 0.0001
            if 0.0001 <= val_float <= 5.0:
                return val_float
            
            # If we are here, the value is garbage (e.g., 20,000,000)
            return None
        except:
            return None

    def _deduplicate_records(self, records: List[TribologyData]) -> List[TribologyData]:
        # Dictionary to store the BEST record for each core fingerprint
        unique_map = {}
        
        print(f"[Deduplication] Smart Merging {len(records)} candidates (with Potential support)...")

        for record in records:
            # --- 1. PRE-CLEANING ---
            # Ensure COF is valid (Safety check from previous steps)
            clean_cof = self._sanitize_cof(record.cof)
            if clean_cof is None: 
                continue 
            record.cof = str(clean_cof)
            
            # Clean other fields for consistency (Normalize numbers/text)
            record.temperature = self._sanitize_numeric_string(record.temperature)
            record.normal_load = self._sanitize_numeric_string(record.normal_load)
            record.speed = self._sanitize_numeric_string(record.speed)
            
            # Use the NEW potential sanitizer
            record.potential = self._sanitize_potential(record.potential)

            # --- 2. RELAXED FINGERPRINT (Now Includes Potential) ---
            # Helper to strip ALL symbols for matching: "[EMIM][TFSI]" == "emimtfsi"
            def deep_norm(val):
                if not val: return ""
                # Remove brackets, spaces, underscores, hyphens, lowercase
                s = str(val).lower()
                s = re.sub(r'[\[\]\(\)\s_\-]', '', s) 
                return s

            # Core Identity: WHAT is rubbing + RESULT + POTENTIAL
            # We ignore Load/Speed in the identity to catch "Partial Matches" (e.g. one has load, one doesn't)
            # Assumption: Same Material + Same IL + Same COF + Same Potential => Same data point
            fingerprint = (
                deep_norm(record.material_name),
                deep_norm(record.ionic_liquid),
                str(round(clean_cof, 3)), # Match 0.040 vs 0.04
                deep_norm(record.potential) # <--- CRITICAL ADDITION
            )

            # --- 3. GREEDY MERGE STRATEGY ---
            if fingerprint not in unique_map:
                # New find
                unique_map[fingerprint] = record
            else:
                # Collision! Compare 'Information Density'
                existing_rec = unique_map[fingerprint]
                
                # Count how many fields are populated
                def count_info(r):
                    score = 0
                    if r.normal_load: score += 1
                    if r.speed: score += 1
                    if r.temperature: score += 1
                    if r.potential: score += 1
                    # Prefer longer IL names (less likely to be abbreviation/partial)
                    if r.ionic_liquid and len(r.ionic_liquid) > 3: score += 0.5 
                    return score
                
                new_score = count_info(record)
                old_score = count_info(existing_rec)
                
                if new_score > old_score:
                    # New record is better (more metadata), replace old one
                    unique_map[fingerprint] = record
                    # print(f"Upgraded record for {fingerprint}: Score {old_score} -> {new_score}")
                else:
                    # Old record is better or equal, ignore new one
                    pass

        merged_list = list(unique_map.values())
        print(f"[Deduplication] Merged {len(records)} -> {len(merged_list)} smart records.")
        return merged_list

    async def extract_tribology_data(self, content: str = "", images: List[str] = None) -> List[TribologyData]:
        """从文献内容（文本或图像）中提取摩擦学数据 - 支持并行分批处理"""
        
        # Base prompt
        base_prompt = """你是一个专业的摩擦学数据提取助手。请从以下文献内容中提取所有离子液体润滑相关的实验数据。
        
        【重要提示：视觉提取模式】
        你现在可以看到文献的部分页面图像。请利用你的视觉能力：
        1. 准确识别图表（Figures）中的数据点、趋势和图注信息。
        2. 识别表格（Tables）的结构，准确提取行列数据。
        3. 关联正文描述与图表内容。

        CRITICAL RULE: Only extract data records that contain explicit Friction Coefficient (COF) or Friction Force measurements.
        - If a section describes synthesis, TGA, DSC, or molecular structure WITHOUT friction testing, IGNORE IT COMPLETELY.
        - Do not generate records with 'null' COF just to list a material.
        - If no friction data is found in a section, return nothing for that section.

        ═══════════════════════════════════════════════════════════════
        【PART I: 字段定义与同义词映射】
        ═══════════════════════════════════════════════════════════════
        
        对于每条数据记录，请提取以下字段：
        
        【核心字段】
        - material_name: 材料名称/基底表面。标准术语：Mica、HOPG、Au(111)、Silica、Stainless steel、Titanium
          *同义词映射*: "Gold (111)" → "Au(111)", "Silicon" → "Silica"
          
        - ionic_liquid: 离子液体名称。标准格式：[BMIM][PF6], [EMIM][TFSI], [P6,6,6,14][BTA]
          *同义词映射*: "1-butyl-3-methylimidazolium" → "[BMIM]", "imidazolium" → 提取具体阳离子
          **务必保留方括号和完整结构**
          
        - cation: 阳离子类型（'HMIM', 'P6,6,6,14', 'C2MIM'）。当文献重点对比阳离子链长时提取
          *同义词映射*: "chain length effect" 时需单独提取; "EMIM" = "[EMIM]"去掉括号
        
        【电学/温度字段】
        - potential: 电化学电势/电压。标准格式：'+1.5V', '-1.0V', 'OCP'
          *同义词映射*: "Voltage" → potential, "V (voltage)" → potential, "Bias" → potential
          **特殊值**: "Open Circuit Potential" → 'OCP', "OCP" → 'OCP' (保留原样，不转换数值)
          **保留符号**: 务必区分 +1.5V 和 -1.5V
          
        - temperature: 温度
          *同义词映射*: "T", "Temp", "Heating" → temperature
          **特殊推断**:
            - "Room Temperature" / "RT" / "Ambient" → "298.15 K"
            - "25°C" / "25 C" → "298.15 K"
            - 数值 < 200 通常为 °C，需转换为 K (value + 273.15)
            - 数值 > 200 且无单位通常已是 K
        
        【力学/摩擦字段】
        - cof: 摩擦系数。格式："0.05" 或 "< 0.01"
          *同义词映射*: "Friction Coefficient", "μ", "μ(kinetic)", "Coefficient of Friction" → cof
          **Sanity Check**: 若 COF > 1.5 或 < 0.001，必须确保原文明确提及，否则视为提取错误或单位错误。
          **STRICT FORMAT RULE**: Must contain specific numerical values (e.g., '0.01', '< 0.05', '0.02-0.04').
          - Do NOT extract qualitative descriptions like 'increases with load', 'very low', or 'function of viscosity'.
          - If the text describes a trend without a specific number, set the field to `null`.
          
        - friction_force: 摩擦力。格式："1.1 nN", "5 mN" (带单位)
          *同义词映射*: "Friction", "Fric.", "F_friction", "Lateral force" → friction_force
          **重要**: 即使 cof 已给出，也必须提取此字段用于验证/计算
          **STRICT FORMAT RULE**: Must contain specific numerical values. No descriptions.
          
        - normal_load: 法向载荷。格式："55 nN", "10 N" (带单位)
          *同义词映射*: "Load", "Normal force", "N (Normal)", "F_N" → normal_load
          **重要**: 即使 cof 已给出，也必须提取此字段用于验证/计算
        
        【材料表征字段】
        - surface_roughness: 表面粗糙度。格式："RMS 4.9 nm", "Ra 0.1 nm", "Rq 2.3 nm"
          *同义词映射*: "Roughness", "Ra", "RMS", "Rq", "Surface profile" → surface_roughness
          **关键**: 这是区分不同样品的重要参数。若有多个粗糙度值，拆为多行记录
          
        - film_thickness: 膜厚。格式："7 layers", "2 nm", "10 Å"
          *同义词映射*: "Thickness", "Layer(s)", "h", "d (depth)" → film_thickness
          **常见场景**: 力曲线（AFM）分析中，表示离子层厚度
          
        - water_content: 含水量/湿度。格式："50 ppm", "100 ppm", "IL-50%", "0%"
          *同义词映射*: "Moisture", "H2O content", "Humidity" → water_content
          **严格提取**: 仅提取原文明确提到的数值。禁止推断 "humid" / "ambient" 为特定百分比。
        
        【实验条件字段】
        - load: 载荷。单位：N (需标准化)
          *同义词映射*: "Applied load", "Contact load", "Loading force" → load
          
        - speed: 速度。单位：mm/s 或 rpm
          *同义词映射*: "Sliding speed", "Velocity", "Rotation speed" → speed
          
        - concentration: 浓度。格式："10 wt%", "5 mol/L", "10%"
          *同义词映射*: "Concentration", "Conc.", "wt%", "molarity" → concentration
          
        - mol_ratio: 混合比。格式："1:70", "50 mol%", "3:1"
          *同义词映射*: "Molar ratio", "Blend ratio", "Mixing ratio" → mol_ratio
          **应用**: 当混合两种离子液体或 IL + 油脂时
          
        - contact_type: 接触类型。标准值："ball-on-disk", "pin-on-disk", "ball-on-plate", "AFM"
          *同义词映射*: "geometry", "configuration", "test setup" → contact_type
          
        - wear_rate: 磨损率。格式及单位："1.2e-5 mm³/(N·m)"
          
        - test_duration: 测试时间。格式："1000 cycles", "10 min", "2 hours"
          *同义词映射*: "Test time", "Duration", "Sliding distance" → test_duration
        
        【附加字段】
        - base_oil: 基础油名称 (若有)。如 "PAO", "Mineral oil"
        - source: 数据来源。必须精确！！
          **规则**:
          1. 如果数据来自表格，必须提取表号，如 "Table 1", "Table S2"。
          2. 如果数据来自图表，必须提取图号，如 "Fig. 3a", "Figure 5"。
          3. 如果数据来自正文文本，必须填 "Text"。
          4. **严禁猜测**: 如果找不到明确的 "Table 1" 字样，绝不允许填 "Table 1"！用 "Text" 或 "Unknown" 代替。
          5. 严禁默认!! 不要因为大多数论文有 Table 1 就填 Table 1。
        - notes: 其他备注
        - evidence: 【必须】原文中的关键佐证句子/引用。
          **验证规则**: 对于提取的数值（摩擦系数、载荷、温度等），**必须**在此字段摘录原文中证明该数值的句子。严禁在没有原文依据的情况下推断数值。
        
        ═══════════════════════════════════════════════════════════════
        【PART II: 多行提取策略 - 条件拆分规则】
        ═══════════════════════════════════════════════════════════════
        
        **规则概述**: 同一段文字、表格或图表中，如果包含多个**独立的实验条件**，必须拆分为多行记录。
        
        **触发式拆分的变量列表** (优先级从高到低):
        1. **Potential** (电势): 不同电压下结果不同
           示例: "At +1.5V, COF = 0.001; at -1.0V, COF = 0.1"
           → 生成 2 条记录，分别对应 potential='+1.5V' 和 potential='-1.0V'
           
        2. **Surface Roughness** (粗糙度): 不同表面粗糙度的结果
           示例: "Smooth surface (0.1 nm) shows low friction (0.05), but rough surface (6.0 nm) shows high friction (0.2)"
           → 生成 2 条记录，分别对应 surface_roughness="0.1 nm" 和 "6.0 nm"
           
        3. **Temperature** (温度): 不同温度的结果
           示例: "At 25°C, COF = 0.08; at 60°C, COF = 0.12"
           → 生成 2 条记录，分别对应 temperature="298.15 K" 和 "333.15 K"
           
        4. **Cation Chain Length** (链长): 同族阳离子链长对比
           示例: "C2MIM-based IL (0.02), C4MIM-based IL (0.018), C8MIM-based IL (0.015)"
           → 生成 3 条记录，分别提取 cation="C2MIM", "C4MIM", "C8MIM"
           
        5. **Mol Ratio** (混合比): 不同混合比例的结果
           示例: "IL + oil at 1:10 (μ=0.1) vs. 1:70 (μ=0.05)"
           → 生成 2 条记录，分别对应 mol_ratio="1:10" 和 "1:70"
           
        6. **Water Content** (含水量): 不同含水量的结果
           示例: "IL-0% (μ=0.01) vs. IL- 44% (μ=0.05)"
           → 生成 2 条记录，分别对应 water_content="0%" 和 "44%"
           
        7. **其他参数**: load (载荷), speed (速度), concentration (浓度)
           应用同上规则
           
        **柱状图/折线图处理**:
        - 柱状图 (Bar chart): 每条柱子对应一个条件，柱高为数值
           示例: Figure 5a 显示 4 种 IL 的 COF，X 轴为 IL 类型，Y 轴为 COF 值
           → 提取 4 条记录，每条对应一种 IL，数值为对应柱高
           **图注必读**: "Figure 5a compares friction coefficients of [BMIM][PF6] (0.08), [EMIM][TFSI] (0.05), ..."
           → 从图注中直接提取具体数值，而不是估计
           
        - 折线图 (Line plot): 每条线代表一个变量，各数据点对应另一变量的值
           示例: Figure 3 显示温度 vs COF，有 3 条线对应 3 种 IL
           → 提取 N*M 条记录 (N=数据点数, M=线条数)
           **关键**: 仔细读取坐标轴标签的单位 (如 X轴是 °C, Y轴是 μ)
           
        **表格处理**:
        - 表格每一行通常对应一条实验记录
           - 若表格列包含变量 (如 potential, temperature)，检查表题是否暗示参数变化
           示例: Table 1 标题 "Friction data at different potentials"
           → 每一行拆为单独的记录
           
        **文本混合场景** (最常见的综述模式):
        原文示例:
        "In our study, [BMIM][PF6] was tested on mica and silica surfaces at room temperature and 60°C.
        On mica at 25°C, we observed COF = 0.05. At 60°C, the COF increased to 0.08.
        On silica, the trend was similar: 0.08 at 25°C, 0.12 at 60°C."
        
        拆分逻辑:
        - 基础参数: ionic_liquid=[BMIM][PF6]
        - 变量: material_name (mica vs silica), temperature (298K vs 333K)
        - 组合数: 2 × 2 = 4 条记录
        
        输出:
        Record 1: ionic_liquid=[BMIM][PF6], material_name=Mica, temperature=298.15 K, cof=0.05
        Record 2: ionic_liquid=[BMIM][PF6], material_name=Mica, temperature=333.15 K, cof=0.08
        Record 3: ionic_liquid=[BMIM][PF6], material_name=Silica, temperature=298.15 K, cof=0.08
        Record 4: ionic_liquid=[BMIM][PF6], material_name=Silica, temperature=333.15 K, cof=0.12
        
        ═══════════════════════════════════════════════════════════════
        【PART III: 缺失值推断与标准化映射】
        ═══════════════════════════════════════════════════════════════
        
        当遇到以下缺失值或特殊值时，应用以下映射规则:
        
        **温度类**:
        | 原文表述 | 标准化值 | 备注 |
        |---------|---------|------|
        | "RT" / "Room Temp" | "298.15 K" | 标准温度，Kelvin制 |
        | "Ambient" / "25°C" | "298.15 K" | |
        | "Heated to X°C" | "X + 273.15 K" | 记录在 K 中 |
        | "-" / "N.A." / "不适用" | null | 真正缺失 |
        
        **电势类**:
        | 原文表述 | 标准化值 | 备注 |
        |---------|---------|------|
        | "OCP" / "Open Circuit" | "OCP" | 保留原样，不转换数值 |
        | "+1.5V" / "1.5 V" | "+1.5V" | 务必保留正号 |
        | "-1.0V" / "-1 V" | "-1.0V" | 务必保留负号 |
        | "Zero potential" | "0V" | |
        | "Unspecified" / "-" | null | |
        
        **浓度/比值类**:
        | 原文表述 | 标准化值 | 应用字段 |
        |---------|---------|---------|
        | "10 wt%" / "10%" | "10 wt%" | concentration |
        | "1:70 (molar)" | "1:70" | mol_ratio |
        | "Pure" / "100%" | "100%" | concentration |
        | "-" / "Not reported" | null | |
        
        **含水量/湿度类**:
        | 原文表述 | 标准化值 | 备注 |
        |---------|---------|------|
        | "50 ppm H2O" / "50 ppm" | "50 ppm" | 精确值优先 |
        | "Dried" / "Vacuum" / "Dry" | "0%" | 仅当明确提及干燥处理时 |
        | "RH 50%" | "IL-50%" | 保留原格式 |
        | "-" / "Unknown" | null | |
        
        ═══════════════════════════════════════════════════════════════
        【PART IV: 多模态利用 - 图表与图注的提取】
        ═══════════════════════════════════════════════════════════════
        
        **关键原则**: **图表（Figures）和表格（Tables）通常包含最集中的实验数据。必须优先从图表中提取数值。**
        
        **① 图注 (Figure Caption) - 最重要的上下文源**:
        - 图注通常列出实验的关键参数和结果数值
        - 示例: "Figure 3f: Friction coefficient of [EMIM][TFSI] on mica at +1.5V and -1.0V potentials."
        - **必须仔细阅读图注中的所有数值、单位、条件**
        
        **② 坐标轴标签**:
        - X 轴、Y 轴标签提示了该图的主要变量和单位
        - 示例: X轴 "Temperature (°C)", Y轴 "Friction Coefficient (μ)"
        - 记得单位转换: °C → K
        
        **③ 数据点坐标值 & 曲线**:
        - 若图表有坐标网格线，可直接从数据点位置读取数值
        - 读取图例 (Legend) 确定每条线对应的条件
        
        ═══════════════════════════════════════════════════════════════
        【PART V: 提取规则总结】
        ═══════════════════════════════════════════════════════════════
        
        **核心优先级**:
        1. 图表中的明确数值 (Figure caption 中的 "X is Y")
        2. 正文中的明确数值 (Results section: "COF = 0.05 at ...")
        3. 表格数据
        4. 对比推断 (using inequalities: <, >, ≤, ≥)
        
        **Strict Rules**:
        - 禁止推断 source (e.g. "Table 1" if text doesn't say so)
        - 禁止推断 water_content, load, speed if not explicitly stated
        
        ### CRITICAL RULE: FIGURE-MATERIAL BINDING (High Priority)
        1. When extracting data from a specific Figure (e.g., "Figure 12c"):
           - You MUST verify the Material Name and Ionic Liquid strictly within that Figure's Caption or the specific text paragraph referencing "Figure 12".
           - DO NOT infer the material from surrounding paragraphs that discuss other figures (e.g., do not mix Fig 12 data with Fig 15 materials).
           - If the text says "Unlike [EMIM]... [HMIM] shows...", make sure you assign the data to [HMIM], not [EMIM].

        2. VERIFICATION STEP:
           - Before outputting a record, ask: "Does the caption of the source figure explicitly name this material?"
           - If No, discard the material association.
           - For every record, you MUST provide the 'evidence' field quoting the exact text that links the Material/IL to the Data values.
           - Example Evidence: "Fig 12c caption: Friction of [HMIM][FAP] on Graphite..."
        
        **JSON 返回格式**:
        {
          "data": [
            { "material_name": "Mica", "ionic_liquid": "[BMIM][PF6]", "cof": "0.05", "source": "Fig. 3", "evidence": "Fig 3 caption states..." }
          ]
        }
        
        文献内容：
        """
        
        all_tribology_data = [] # 存储所有批次的汇总结果
        BATCH_SIZE = 3      # Reduced batch size for stability (Parallel + Compressed)
        
        # Determine batches
        if images and len(images) > 0:
            total_images = len(images)
            batches = []
            for i in range(0, total_images, BATCH_SIZE):
                batches.append(images[i:i + BATCH_SIZE])
            
            print(f"[LLM Service] Processing {total_images} images in {len(batches)} batches (Size={BATCH_SIZE}) - Parallel")
        else:
            # No images, single batch of text
            batches = [None]
            
        # Create asynchronous tasks for all batches
        tasks = []
        for batch_idx, batch_images in enumerate(batches):
            tasks.append(
                self._process_batch(batch_idx, len(batches), batch_images, content, base_prompt)
            )
            
        # Execute in parallel with gather
        # Optional: Add semaphore here if rate limits become an issue, 
        # but defaulting to full parallelism for now as requested.
        results = await asyncio.gather(*tasks)
        
        # Flatten results
        for res_list in results:
             all_tribology_data.extend(res_list)

        # Post-Processing (Merged Data)
        print(f"[LLM Service] Total extracted raw records: {len(all_tribology_data)}")
        
        string_fields = ['load', 'speed', 'temperature', 'cof', 'wear_rate', 
                       'test_duration', 'concentration', 'base_oil', 'contact_type',
                       'material_name', 'ionic_liquid', 'source', 'notes', 
                       'friction_force', 'normal_load', 'value_origin',
                       'potential', 'water_content', 'surface_roughness',
                       'film_thickness', 'mol_ratio', 'cation', 'evidence']
        
        converted_data = []
        for item in all_tribology_data:
            if item:
                # --- STRICT FILTERING START ---
                # Check if COF or Friction Force exists AND is numeric
                # 1. Get raw values
                raw_cof = item.get('cof')
                raw_force = item.get('friction_force')

                # 2. Check validity using numeric filter
                is_cof_valid = self._is_valid_numeric_entry(raw_cof)
                is_force_valid = self._is_valid_numeric_entry(raw_force)
                
                # User only wants friction data. If neither is valid numeric, SKIP.
                if not is_cof_valid and not is_force_valid:
                    continue
                # --- STRICT FILTERING END ---

                # Type Conversion
                for field in string_fields:
                    if field in item and item[field] is not None:
                        if not isinstance(item[field], str):
                            item[field] = str(item[field])
                
                # Temperature Normalization
                if 'temperature' in item and item['temperature']:
                    original_temp = item['temperature']
                    normalized_temp = normalize_temperature(str(original_temp))
                    item['temperature'] = normalized_temp
                
                converted_data.append(item)
        
        # Clean Data
        # converted_data = calculate_missing_cof(converted_data) # REMOVED: Rogue calculation logic
        converted_data = set_default_temperature(converted_data)
        converted_data = normalize_surface_terms(converted_data)
        converted_data = normalize_ionic_liquid_terms(converted_data)
        
        valid_records = []
        for item in converted_data:
            # 1. Sanitize Mandatory Fields
            if not item.get('material_name'):
                item['material_name'] = "Unknown Material"
            
            if not item.get('ionic_liquid'):
                item['ionic_liquid'] = "Unknown IL"

            # 2. Try-Catch for individual records
            try:
                record = TribologyData(**item)
                valid_records.append(record)
            except Exception as e:
                print(f"[Warning] Skipping invalid record: {e} | Data: {item}")
                continue

        # Remove duplicates based on content fingerprint
        deduplicated_records = self._deduplicate_records(valid_records)
        print(f"[Deduplication] Removed {len(valid_records) - len(deduplicated_records)} duplicates.")
        return deduplicated_records
    
    # ========== Pass 1: 元数据提取 (仅首页) ==========
    async def _extract_metadata_only(self, content: str, images: List[str] = None) -> dict:
        """从文献首页提取元数据 (仅使用前4000字符 或 首页图像)
        
        Args:
            content: 完整文献内容
            images: 页面图像列表 (Paths or Base64)
        """
        # 只看前4000字符 (通常包含标题页和版权信息)
        header_content = content[:4000] if content else ""
        
        default_metadata = {
            "title": "",
            "authors": "",
            "doi": "",
            "journal": "",
            "issn": None,
            "year": None,
            "volume": None,
            "issue": None,
            "pages": None
        }
        
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

        user_message_content = []
        user_message_content.append({"type": "text", "text": f"Extract metadata from this paper header:\n\n{header_content}"})
        
        # Add First Page Image if available (Crucial for header analysis)
        if images and len(images) > 0:
            image_data_url = self._prepare_image_input(images[0])
            if image_data_url:
                user_message_content.append({
                   "type": "image_url",
                    "image_url": {
                         "url": image_data_url
                    }
                })
            
        try:
            response = await self.text_client.chat.completions.create(
                model=self.text_model, # Use Text Model (Claude 3.5 Sonnet)
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message_content}
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
    # ========== 主入口: 双通道提取 ==========
    async def extract_with_metadata(self, content: str, images: List[str] = None) -> dict:
        """从文献中同时提取元数据和摩擦学数据 (双通道策略 + DOI Enrichment)
        
        Args:
            content: 完整文献内容 (text fallback)
            images: List of images (Paths or Base64) for Vision source
        
        使用 Two-Pass Extraction Strategy:
        - Pass 1: 从首页提取元数据（快速，仅4000字符）
        - Pass 1.5: 如果提取到 DOI，使用 Crossref API 获取权威元数据
        - Pass 2: 从全文提取摩擦学数据（使用原始高性能 Prompt）
        
        Returns:
            dict: {
                "metadata": { title, doi, authors, journal, year, ... },
                "data": [ TribologyData, ... ]  # 注意: 改为 "data" 以匹配前端期望
            }
        """
        print("[Two-Pass Extraction] Starting Pass 1: Metadata extraction...")
        llm_metadata = await self._extract_metadata_only(content, images)
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
        
        print("[Two-Pass Extraction] Starting Pass 2: Tribology data extraction (Vision/Full content)...")
        records = await self.extract_tribology_data(content, images)  # 复用原始高性能方法 (Updated for Vision)
        print(f"[Two-Pass Extraction] Pass 2 complete. Records: {len(records)}")
        
        # GLOBAL DEDUPLICATION: Remove duplicates across all batches
        print(f"[Global] Deduplicating {len(records)} total aggregated records...")
        records = self._deduplicate_records(records)
        print(f"[Global] Final unique records: {len(records)}")
        
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
                "film_thickness": record.film_thickness,
                "mol_ratio": record.mol_ratio,
                "cation": record.cation,
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
    
    async def chat(self, message: str, context: Optional[str] = None) -> str:
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
            response = await self.text_client.chat.completions.create(
                model=self.text_model, # Use Text Model for Chat
                messages=messages,
                temperature=0.7
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"抱歉，处理请求时出现错误：{str(e)}"


# 创建全局实例
llm_service = LLMService()
