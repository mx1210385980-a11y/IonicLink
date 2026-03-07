"""
SQLAlchemy ORM Models for IonicLink (Refactored)
Definition of Literature (metadata) and TribologyData (records) tables.
"""

from datetime import datetime
from typing import Optional, List
from sqlalchemy import (
    String, Float, Integer, ForeignKey, Text, func
)
from sqlalchemy.orm import relationship, Mapped, mapped_column
import sys
import os

# Ensure database is importable
# sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
# Use relative import if possible or ensure path is set. Assuming execution from backend root usually works.
# But keeping the original hack for safety if run directly.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import Base


class Literature(Base):
    """
    文献元数据表 (Literature Metadata)
    Stores identity and bibliographic info of the source document.
    """
    __tablename__ = "literature"

    # Primary Key: Integer (AutoIncrement)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # 身份标识 (ID Layer)
    doi: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False, comment="Digital Object Identifier")

    # 内容与容器 (Content & Container)
    title: Mapped[str] = mapped_column(String(500), nullable=False, comment="文献标题")
    authors: Mapped[str] = mapped_column(Text, nullable=False, comment="作者列表 (Comma separated or JSON)")
    journal: Mapped[str] = mapped_column(String(200), nullable=False, comment="期刊名")
    issn: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, comment="ISSN")

    # 时间与坐标 (Time & Location)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    volume: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    issue: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    pages: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    
    # Text Content (New Field for Reprocess Fallback)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="Extracted text content of the file")

    # File Info
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True, comment="本地 PDF 路径 (可选)")

    # Processing Status Fields
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True, comment="Processing status: pending, processing, completed, failed")
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="Error message if processing failed")

    # Common fields
    created_at: Mapped[datetime] = mapped_column(default=func.now())

    # Relationship
    tribology_data: Mapped[List["TribologyData"]] = relationship(
        "TribologyData",
        back_populates="literature",
        cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Literature(id={self.id}, doi='{self.doi}', title='{self.title[:30]}...')>"


class TribologyData(Base):
    """
    摩擦学数据表 (Tribology Data Points)
    Stores specific experimental data points extracted from literature.
    """
    __tablename__ = "tribology_data"

    # Primary Key: Integer (AutoIncrement)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Foreign Key -> Literature
    literature_id: Mapped[int] = mapped_column(ForeignKey("literature.id"), nullable=False)

    # Material & Lubricant
    material_name: Mapped[str] = mapped_column(String(255), nullable=False, comment="材料名称/基底表面 (Mica, HOPG, Au(111), Silica, Stainless steel, Titanium)")
    lubricant: Mapped[str] = mapped_column(String(255), nullable=False)

    # COF Data
    cof_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Recommend REAL/FLOAT
    cof_operator: Mapped[Optional[str]] = mapped_column(String(10), nullable=True, comment="e.g., <, >, ~, =")
    cof_raw: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="Original extracted text")

    # Load Data
    load_value: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="Load value with unit (e.g., '20 nN', '10 N')")
    load_raw: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Speed & Temperature
    speed_value: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="Speed with unit (e.g., '5 mm/s', '100 rpm')")
    temperature: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="Temperature with unit (e.g., '298.15 K', '25°C')")

    # Environmental Variables (New)
    potential: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="Electrochemical potential (e.g., '+1.5V', 'OCP')")
    water_content: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="Water concentration or humidity (e.g., '50 ppm', 'Dry')")
    surface_roughness: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="Surface roughness (e.g., 'RMS 4.9 nm')")
    
    # Film Thickness - Split into two distinct parameters (Nanoconfinement)
    residual_film_thickness_d: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="Total confined thickness at hard wall (e.g., '3 nm', typically > 1.5 nm)")
    layer_spacing_delta: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="Single molecular layer thickness from steps/oscillations (e.g., '0.7 nm', typically < 1.0 nm)")
    film_thickness: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="[Deprecated] Generic film thickness - use specific fields above")
    
    mol_ratio: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="Molar ratio (e.g., '1:70')")
    cation: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="Cation type (e.g., 'HMIM', 'P66614')")
    anion: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="Anion type (e.g., 'TFSI', 'PF6')")
    cation_smiles: Mapped[Optional[str]] = mapped_column(String(500), nullable=True, comment="Cation SMILES")
    anion_smiles: Mapped[Optional[str]] = mapped_column(String(500), nullable=True, comment="Anion SMILES")
    il_smiles: Mapped[Optional[str]] = mapped_column(String(500), nullable=True, comment="Full IL SMILES (cation.anion)")
    il_inchikey: Mapped[Optional[str]] = mapped_column(String(27), nullable=True, index=True, comment="InChIKey for cross-literature alignment")
    alkyl_chain_length: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="Alkyl chain length of cation")

    # Tracking Fields
    extracted_at: Mapped[datetime] = mapped_column(default=func.now(), comment="Extraction timestamp")
    confidence: Mapped[float] = mapped_column(Float, default=0.9, comment="AI Confidence (0.0-1.0)")
    evidence: Mapped[Optional[str]] = mapped_column(Text, nullable=True, comment="Verbatim evidence/quote from text")
    evidence_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, comment="1-based PDF page where evidence was found")
    evidence_bbox: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, comment="JSON bbox [x0,y0,x1,y1] in PDF points for the evidence")
    source: Mapped[Optional[str]] = mapped_column(String(200), nullable=True, comment="Source label: Fig. X, Table Y, or Text")

    # Relationship
    literature: Mapped["Literature"] = relationship(
        "Literature",
        back_populates="tribology_data"
    )

    def __repr__(self):
        return f"<TribologyData(id={self.id}, material='{self.material_name}', cof={self.cof_value})>"
