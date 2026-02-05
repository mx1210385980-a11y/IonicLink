#!/usr/bin/env python3
"""
DOI解析服务
支持通过Crossref API解析DOI并获取文献元数据
"""

import logging
import httpx
import asyncio
from typing import Optional, Dict, Any
from pydantic import BaseModel
import json

logger = logging.getLogger(__name__)


class DOIMetadata(BaseModel):
    """DOI元数据"""
    title: Optional[str] = None
    authors: Optional[str] = None
    doi: str
    journal: Optional[str] = None
    volume: Optional[str] = None
    issue: Optional[str] = None
    pages: Optional[str] = None
    year: Optional[int] = None
    issn: Optional[str] = None
    abstract: Optional[str] = None
    url: Optional[str] = None
    pdf_url: Optional[str] = None


class DOIService:
    """DOI解析服务"""
    
    def __init__(self):
        self.base_url = "https://api.crossref.org"
        self.timeout = 30.0
        self.max_retries = 3
    
    async def resolve_doi(self, doi: str) -> Optional[DOIMetadata]:
        """
        解析DOI并获取文献元数据
        
        Args:
            doi: DOI字符串
            
        Returns:
            DOIMetadata: 文献元数据
        """
        if not doi:
            raise ValueError("DOI不能为空")
        
        # 标准化DOI格式
        doi = self._normalize_doi(doi)
        
        # 构造API URL
        url = f"{self.base_url}/works/{doi}"
        
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                for attempt in range(self.max_retries):
                    try:
                        response = await client.get(url)
                        response.raise_for_status()
                        
                        data = response.json()
                        message = data.get("message", {})
                        
                        # 解析元数据
                        metadata = self._parse_metadata(message, doi)
                        logger.info(f"成功解析DOI: {doi}")
                        return metadata
                        
                    except httpx.RequestError as e:
                        if attempt < self.max_retries - 1:
                            await asyncio.sleep(2 ** attempt)  # 指数退避
                            continue
                        raise Exception(f"网络请求失败: {str(e)}")
                    except Exception as e:
                        logger.error(f"解析DOI失败: {str(e)}")
                        raise
                        
        except Exception as e:
            logger.error(f"解析DOI {doi} 失败: {str(e)}")
            return None
    
    async def get_pdf_url(self, doi: str) -> Optional[str]:
        """
        尝试获取PDF下载链接
        
        Args:
            doi: DOI字符串
            
        Returns:
            str: PDF下载链接（如果可用）
        """
        try:
            # 首先尝试从CrossRef获取PDF链接
            url = f"{self.base_url}/works/{doi}"
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(url)
                response.raise_for_status()
                
                data = response.json()
                message = data.get("message", {})
                
                # 查找PDF链接
                if "link" in message:
                    for link in message["link"]:
                        if link.get("content-type") == "application/pdf":
                            return link.get("URL")
                
                # 查找OA链接
                if "open-access" in message:
                    oa_links = message["open-access"]
                    if isinstance(oa_links, list):
                        for link in oa_links:
                            if link.get("content-type") == "application/pdf":
                                return link.get("URL")
                    elif isinstance(oa_links, dict):
                        if oa_links.get("content-type") == "application/pdf":
                            return oa_links.get("URL")
                
                # 尝试构造常见的PDF链接
                if "URL" in message:
                    base_url = message["URL"]
                    # 一些出版商在URL后加上.pdf可以获取PDF
                    pdf_url = base_url.rstrip('/') + ".pdf"
                    return pdf_url
                    
        except Exception as e:
            logger.warning(f"获取PDF链接失败: {str(e)}")
            
        return None
    
    def _normalize_doi(self, doi: str) -> str:
        """标准化DOI格式"""
        doi = doi.strip()
        if doi.startswith("http"):
            # 提取DOI部分
            if "doi.org/" in doi:
                doi = doi.split("doi.org/")[-1]
        elif doi.startswith("doi:"):
            doi = doi[4:]  # 移除"doi:"前缀
            
        return doi
    
    def _parse_metadata(self, message: Dict[str, Any], doi: str) -> DOIMetadata:
        """解析Crossref返回的元数据"""
        # 提取标题
        title = None
        if "title" in message and message["title"]:
            title = message["title"][0] if isinstance(message["title"], list) else message["title"]
        
        # 提取作者
        authors = None
        if "author" in message:
            author_list = []
            for author in message["author"]:
                if "family" in author:
                    name = author["family"]
                    if "given" in author:
                        name = f"{author['given']} {name}"
                    author_list.append(name)
            if author_list:
                authors = "; ".join(author_list)
        
        # 提取期刊信息
        journal = None
        if "container-title" in message and message["container-title"]:
            journal = message["container-title"][0] if isinstance(message["container-title"], list) else message["container-title"]
        
        # 提取卷号、期号、页码
        volume = message.get("volume")
        issue = message.get("issue")
        pages = message.get("page")
        
        # 提取年份
        year = None
        if "published" in message and "date-parts" in message["published"]:
            date_parts = message["published"]["date-parts"]
            if date_parts and len(date_parts) > 0 and len(date_parts[0]) > 0:
                year = date_parts[0][0]
        elif "issued" in message and "date-parts" in message["issued"]:
            date_parts = message["issued"]["date-parts"]
            if date_parts and len(date_parts) > 0 and len(date_parts[0]) > 0:
                year = date_parts[0][0]
        
        # 提取ISSN
        issn = None
        if "ISSN" in message and message["ISSN"]:
            issn = message["ISSN"][0] if isinstance(message["ISSN"], list) else message["ISSN"]
        
        # 提取摘要
        abstract = message.get("abstract")
        
        # 提取URL
        url = None
        if "URL" in message:
            url = message["URL"]
        
        # 尝试提取PDF URL
        pdf_url = None
        if "link" in message:
            for link in message["link"]:
                if link.get("content-type") == "application/pdf":
                    pdf_url = link.get("URL")
                    break
        
        # 如果没有找到PDF链接，查找OA链接
        if not pdf_url and "open-access" in message:
            oa_links = message["open-access"]
            if isinstance(oa_links, list):
                for link in oa_links:
                    if link.get("content-type") == "application/pdf":
                        pdf_url = link.get("URL")
                        break
            elif isinstance(oa_links, dict):
                if oa_links.get("content-type") == "application/pdf":
                    pdf_url = oa_links.get("URL")
        
        # 构造元数据对象
        metadata = DOIMetadata(
            title=title,
            authors=authors,
            doi=doi,
            journal=journal,
            volume=volume,
            issue=issue,
            pages=pages,
            year=year,
            issn=issn,
            abstract=abstract,
            url=url,
            pdf_url=pdf_url
        )
        
        return metadata