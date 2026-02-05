from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class TribologyData(BaseModel):
    """摩擦学数据模型"""
    id: Optional[str] = None
    material_name: str = Field(..., description="材料名称")
    ionic_liquid: Optional[str] = Field("", description="离子液体类型")
    base_oil: Optional[str] = Field(None, description="基础油")
    concentration: Optional[str] = Field(None, description="浓度")
    load: Optional[str] = Field(None, description="载荷 (N)")
    speed: Optional[str] = Field(None, description="速度 (mm/s 或 rpm)")
    temperature: Optional[str] = Field(None, description="温度 (K 或 °C)")
    cof: Optional[str] = Field(None, description="摩擦系数 (COF)")
    friction_force: Optional[str] = Field(None, description="摩擦力 (带单位，如 '1.1 nN')")
    normal_load: Optional[str] = Field(None, description="法向载荷 (带单位，如 '55 nN')")
    wear_rate: Optional[str] = Field(None, description="磨损率")
    test_duration: Optional[str] = Field(None, description="测试时间")
    contact_type: Optional[str] = Field(None, description="接触类型 (ball-on-disk等)")
    # Environmental variables
    potential: Optional[str] = Field(None, description="电化学电势/电压 (如 '+1.5V', 'OCP', '-1.0V')")
    water_content: Optional[str] = Field(None, description="含水量或湿度 (如 '50 ppm', 'Dry', '10 wt%')")
    surface_roughness: Optional[str] = Field(None, description="表面粗糙度 (如 'RMS 0.1 nm', 'Ra 4.9 nm')")
    source: Optional[str] = Field(None, description="文献来源")
    notes: Optional[str] = Field(None, description="备注")
    value_origin: Optional[str] = Field(None, description="数据来源标记 ('extracted' 或 'calculated')")


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
    file_hash: Optional[str] = Field(None, description="File content hash for caching")
    
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
