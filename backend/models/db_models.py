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

    # File Info
    file_path: Mapped[str] = mapped_column(String(500), nullable=False, comment="本地 PDF 路径")
    file_hash: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, unique=True, index=True,
        comment="File content hash (MD5/SHA256) for deduplication"
    )

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
    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    lubricant: Mapped[str] = mapped_column(String(255), nullable=False)

    # COF Data
    cof_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # Recommend REAL/FLOAT
    cof_operator: Mapped[Optional[str]] = mapped_column(String(10), nullable=True, comment="e.g., <, >, ~, =")
    cof_raw: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, comment="Original extracted text")

    # Load Data
    load_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    load_raw: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Speed & Temperature
    speed_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="Standardized Speed")
    temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True, comment="Temperature in Kelvin or Celsius (Needs standardization)")

    # Environmental Variables (New)
    potential: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="Electrochemical potential (e.g., '+1.5V', 'OCP')")
    water_content: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="Water concentration or humidity (e.g., '50 ppm', 'Dry')")
    surface_roughness: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, comment="Surface roughness (e.g., 'RMS 4.9 nm')")

    # Tracking Fields
    extracted_at: Mapped[datetime] = mapped_column(default=func.now(), comment="Extraction timestamp")
    confidence: Mapped[float] = mapped_column(Float, default=0.9, comment="AI Confidence (0.0-1.0)")

    # Relationship
    literature: Mapped["Literature"] = relationship(
        "Literature",
        back_populates="tribology_data"
    )

    def __repr__(self):
        return f"<TribologyData(id={self.id}, material='{self.material_name}', cof={self.cof_value})>"
