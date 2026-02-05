import os
import uuid
import hashlib
from typing import List
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from PyPDF2 import PdfReader
import io

from sqlalchemy.ext.asyncio import AsyncSession

from models.tribology import TribologyData, ExtractionResponse, ChatRequest, LiteratureMetadata
from models.db_models import Literature, TribologyData as TribologyDataDB
from services.llm_service import llm_service
from services.data_sync_service import get_literature_by_hash, get_records_by_literature
from services.score_service import calculate_confidence
from database import get_db

router = APIRouter(prefix="/api", tags=["extraction"])

# 临时存储提取的数据
extracted_data_store: dict = {}
uploaded_files_store: dict = {}


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """上传PDF或文本文件"""
    
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    
    # 检查文件类型
    allowed_extensions = ['.pdf', '.txt', '.md']
    file_ext = os.path.splitext(file.filename)[1].lower()
    
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400, 
            detail=f"不支持的文件类型。支持的类型：{', '.join(allowed_extensions)}"
        )
    
    try:
        content = await file.read()
        
        # Compute file hash for smart caching (MD5)
        file_hash = hashlib.md5(content).hexdigest()
        
        # 解析文件内容
        if file_ext == '.pdf':
            text_content = extract_pdf_text(content)
        else:
            text_content = content.decode('utf-8')
        
        # 生成文件ID并存储 (包含 file_hash)
        file_id = str(uuid.uuid4())
        uploaded_files_store[file_id] = {
            "filename": file.filename,
            "content": text_content,
            "size": len(content),
            "file_hash": file_hash  # Store hash for cache lookup
        }
        
        return {
            "success": True,
            "file_id": file_id,
            "filename": file.filename,
            "file_hash": file_hash,  # Return hash to frontend
            "preview": text_content[:500] + "..." if len(text_content) > 500 else text_content
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件处理失败：{str(e)}")


def extract_pdf_text(content: bytes) -> str:
    """从PDF中提取文本"""
    try:
        pdf_reader = PdfReader(io.BytesIO(content))
        text_parts = []
        for page in pdf_reader.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)
        return "\n\n".join(text_parts)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDF解析失败：{str(e)}")


@router.post("/extract/{file_id}", response_model=ExtractionResponse)
async def extract_data(file_id: str, db: AsyncSession = Depends(get_db)):
    """从上传的文件中提取文献元数据和摩擦学数据 (with Smart Caching)"""
    
    if file_id not in uploaded_files_store:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    file_info = uploaded_files_store[file_id]
    content = file_info["content"]
    file_hash = file_info.get("file_hash")
    
    try:
        # ============ Smart Caching: Check for existing extraction ============
        if file_hash:
            cached_literature = await get_literature_by_hash(db, file_hash)
            
            if cached_literature:
                print(f"[Cache Hit] Found existing data for hash={file_hash}, literature_id={cached_literature.id}")
                
                # Fetch associated TribologyData records
                cached_records = await get_records_by_literature(db, cached_literature.id)
                
                # Convert DB records to response format
                data_list = []
                for i, record in enumerate(cached_records):
                    record_data = {
                        "id": f"{file_id}_{i}",
                        "material_name": record.material_name,
                        "ionic_liquid": record.lubricant,  # Map lubricant to ionic_liquid
                        "lubricant": record.lubricant,
                        "cof": record.cof_raw or str(record.cof_value) if record.cof_value else None,
                        "cof_value": record.cof_value,
                        "cof_operator": record.cof_operator,
                        "cof_raw": record.cof_raw,
                        "load": record.load_raw or str(record.load_value) if record.load_value else None,
                        "load_value": record.load_value,
                        "load_raw": record.load_raw,
                        "speed": str(record.speed_value) if record.speed_value else None,
                        "speed_value": record.speed_value,
                        "temperature": str(record.temperature) if record.temperature else None,
                        "confidence": record.confidence,
                    }
                    data_list.append(record_data)
                
                # Construct cached metadata
                metadata_dict = {
                    "title": cached_literature.title,
                    "authors": cached_literature.authors,
                    "doi": cached_literature.doi or "",
                    "journal": cached_literature.journal,
                    "issn": cached_literature.issn,
                    "year": cached_literature.year,
                    "volume": cached_literature.volume,
                    "issue": cached_literature.issue,
                    "pages": cached_literature.pages,
                    "file_hash": file_hash,   # snake_case for backend
                    "fileHash": file_hash     # camelCase for frontend
                }
                metadata = LiteratureMetadata(**metadata_dict)
                
                # Store in extracted_data_store for consistency
                extracted_data_store[file_id] = {
                    "metadata": metadata_dict,
                    "data": data_list
                }
                
                return ExtractionResponse(
                    success=True,
                    metadata=metadata,
                    data=data_list,
                    message=f"[Cache Hit] 从缓存返回 {len(data_list)} 条数据记录"
                )
        
        # ============ Cache Miss: Proceed with LLM extraction ============
        print(f"[Cache Miss] No cached data found for hash={file_hash}, proceeding with LLM extraction")
        
        # 使用LLM提取元数据和数据 (now async with DOI enrichment)
        result = await llm_service.extract_with_metadata(content)
        
        metadata_dict = result.get("metadata", {})
        data_list = result.get("data", [])  # Changed from "records" to "data"
        
        # 【双重注入】防止前后端命名风格(CamelCase vs SnakeCase)不一致导致丢包
        # Add file_hash to metadata for sync service (both formats for compatibility)
        metadata_dict["file_hash"] = file_hash   # snake_case for backend
        metadata_dict["fileHash"] = file_hash    # camelCase for frontend
        
        # 为每条数据生成ID (data_list 现在是字典列表)
        for i, data in enumerate(data_list):
            data["id"] = f"{file_id}_{i}"
        
        # 创建 LiteratureMetadata 对象
        metadata = LiteratureMetadata(**metadata_dict)
        
        # 存储提取结果 (包含元数据)
        extracted_data_store[file_id] = {
            "metadata": metadata_dict,
            "data": data_list
        }
        
        return ExtractionResponse(
            success=True,
            metadata=metadata,
            data=data_list,
            message=f"成功提取文献元数据和 {len(data_list)} 条数据记录"
        )
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return ExtractionResponse(
            success=False,
            metadata=None,
            data=[],
            message=f"数据提取失败：{str(e)}"
        )


@router.get("/data/{file_id}", response_model=List[TribologyData])
async def get_extracted_data(file_id: str):
    """获取已提取的数据"""
    
    if file_id not in extracted_data_store:
        raise HTTPException(status_code=404, detail="未找到提取数据")
    
    return extracted_data_store[file_id]


@router.get("/data")
async def get_all_data():
    """获取所有提取的数据"""
    all_data = []
    for data_list in extracted_data_store.values():
        all_data.extend(data_list)
    return all_data


@router.post("/chat")
async def chat(request: ChatRequest):
    """与AI助手对话"""
    
    # 获取上下文（最近上传的文件内容）
    context = None
    if request.context:
        context = request.context
    elif uploaded_files_store:
        # 使用最近的文件作为上下文
        latest_file = list(uploaded_files_store.values())[-1]
        context = latest_file["content"][:3000]
    
    response = llm_service.chat(request.message, context)
    
    return {
        "success": True,
        "response": response
    }
