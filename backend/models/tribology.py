from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, List
from datetime import datetime


class TribologyData(BaseModel):
    """摩擦学数据模型"""
    id: Optional[str] = None
    material_name: str = Field(..., description="材料名称/基底表面 (如 Mica, HOPG, Au(111), Silica, Stainless steel, Titanium)")
    ionic_liquid: Optional[str] = Field("", description="离子液体类型")
    base_oil: Optional[str] = Field(None, description="基础油")
    concentration: Optional[str] = Field(None, description="浓度")
    load: Optional[str] = Field(None, description="载荷 (N)")
    speed: Optional[str] = Field(None, description="速度 (mm/s 或 rpm)")
    temperature: Optional[str] = Field(None, description="温度 (K 或 °C)")
    cof: Optional[str] = Field(None, description="摩擦系数 (COF)")
    
    # Database mapping fields (for backward compatibility when loading from DB)
    cof_value: Optional[float] = Field(None, description="COF数值(数据库字段)")
    cof_raw: Optional[str] = Field(None, description="COF原始文本(数据库字段)")
    cof_operator: Optional[str] = Field(None, description="COF比较运算符")
    
    @model_validator(mode='before')
    @classmethod
    def map_cof_from_db_fields(cls, data):
        """当从数据库加载时，自动从 cof_value/cof_raw 映射到 cof 字段"""
        if isinstance(data, dict):
            # 如果 cof 为空但 cof_raw 或 cof_value 有值，自动填充
            if not data.get('cof'):
                if data.get('cof_raw'):
                    data['cof'] = data['cof_raw']
                elif data.get('cof_value') is not None:
                    data['cof'] = str(data['cof_value'])
        return data
    
    friction_force: Optional[str] = Field(None, description="摩擦力 (带单位，如 '1.1 nN')")
    normal_load: Optional[str] = Field(None, description="法向载荷 (带单位，如 '55 nN')")
    wear_rate: Optional[str] = Field(None, description="磨损率")
    test_duration: Optional[str] = Field(None, description="测试时间")
    contact_type: Optional[str] = Field(None, description="接触类型 (ball-on-disk等)")
    # Environmental variables
    potential: Optional[str] = Field(None, description="电化学电势/电压 (如 '+1.5V', 'OCP', '-1.0V')")
    water_content: Optional[str] = Field(None, description="含水量或湿度 (如 '50 ppm', 'Dry', '10 wt%')")
    surface_roughness: Optional[str] = Field(None, description="表面粗糙度 (如 'RMS 0.1 nm', 'Ra 4.9 nm')")
    
    # Film Thickness - Split into two distinct parameters for nanoconfinement studies
    residual_film_thickness_d: Optional[str] = Field(None, description="总残留膜厚 - 高载荷下的硬壁距离 (如 '3 nm', 通常 > 1.5 nm)")
    layer_spacing_delta: Optional[str] = Field(None, description="单层间距 - 单个分子层厚度/离子对尺寸 (如 '0.7 nm', 通常 < 1.0 nm)")
    film_thickness: Optional[str] = Field(None, description="[已弃用] 通用膜厚 - 请使用上述特定字段")
    
    mol_ratio: Optional[str] = Field(None, description="摩尔比 (如 '1:70', '50 mol%')")
    cation: Optional[str] = Field(None, description="阳离子类型 (如 'HMIM', 'C2MIM')")
    anion: Optional[str] = Field(None, description="阴离子类型 (如 'TFSI', 'PF6')")
    cation_smiles: Optional[str] = Field(None, description="Cation SMILES")
    anion_smiles: Optional[str] = Field(None, description="Anion SMILES")
    il_smiles: Optional[str] = Field(None, description="Full IL SMILES")
    il_inchikey: Optional[str] = Field(None, description="InChIKey")
    alkyl_chain_length: Optional[int] = Field(None, description="Alkyl chain length")
    source: Optional[str] = Field(None, description="文献来源")
    notes: Optional[str] = Field(None, description="备注")
    value_origin: Optional[str] = Field(None, description="数据来源标记 ('extracted' 或 'calculated')")
    evidence: Optional[str] = Field(None, description="原文佐证/引用")

    source_page: Optional[int] = Field(None, description="1-based PDF page number for this record")
    source_figure: Optional[str] = Field(None, description="Figure or table label for this record")

class ExtractionRequest(BaseModel):
    """数据提取请求"""
    file_id: str
    content: str


class LiteratureMetadata(BaseModel):
    """文献元数据模型"""
    title: str = Field("", description="文献标题")
    authors: str = Field("", description="作者列表 (comma-separated)")
    doi: str = Field("", description="Digital Object Identifier")
    journal: str = Field("", description="期刊名")
    issn: Optional[str] = Field(None, description="ISSN")
    year: int = Field(2024, description="发表年份")
    volume: Optional[str] = Field(None, description="卷号")
    issue: Optional[str] = Field(None, description="期号")
    pages: Optional[str] = Field(None, description="页码")
    
    class Config:
        populate_by_name = True


class ExtractionResponse(BaseModel):
    """数据提取响应 (包含元数据和数据记录)"""
    success: bool
    metadata: Optional[LiteratureMetadata] = None
    data: List[TribologyData] = []
    message: Optional[str] = None


class ChatMessage(BaseModel):
    """聊天消息"""
    role: str  # 'user' or 'assistant'
    content: str
    timestamp: Optional[datetime] = None


class ChatRequest(BaseModel):
    """聊天请求"""
    message: str
    context: Optional[str] = None
