import os
import uuid
import hashlib
import json
from typing import List
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
import fitz  # PyMuPDF
import base64
import io
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from models.tribology import TribologyData, ExtractionResponse, ChatRequest, LiteratureMetadata
from models.db_models import Literature, TribologyData as TribologyDataDB
from services.llm_service import llm_service
from services.data_sync_service import get_literature_by_hash, get_records_by_literature
from services.score_service import calculate_confidence
from services.score_service import calculate_confidence
from database import get_db
from utils.pdf_utils import process_pdf_to_base64, extract_pdf_text_fitz

router = APIRouter(prefix="/api", tags=["extraction"])

# 临时存储提取的数据
extracted_data_store: dict = {}
uploaded_files_store: dict = {}

# Ensure temp directory exists
TEMP_UPLOAD_DIR = "temp_uploads"
os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)

# Disk I/O functions removed to prevent storage spam



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
        text_content = ""
        base64_images = []
        
        # 生成文件ID并存储 (包含 file_hash)
        file_id = str(uuid.uuid4())
        
        if file_ext == '.pdf':
            # Vision-First: Convert to images (In-Memory)
            print(f"[Upload] Processing PDF to Base64 (Vision Mode)")
            base64_images = process_pdf_to_base64(content)
            
            # Also extract text as fallback/metadata source
            text_content = extract_pdf_text_fitz(content)
        else:
            text_content = content.decode('utf-8')
        
        file_data = {
            "filename": file.filename,
            "content": text_content, # Still keep text for preview/fallback
            "images": base64_images, # NEW: List of base64 strings
            "size": len(content),
            "file_hash": file_hash  # Store hash for cache lookup
        }
        uploaded_files_store[file_id] = file_data
        
        # Persistence to disk removed
        # save_upload_to_disk(file_id, file_data)
        
        return {
            "success": True,
            "file_id": file_id,
            "filename": file.filename,
            "file_hash": file_hash,  # Return hash to frontend
            "preview": text_content[:500] + "..." if len(text_content) > 500 else text_content
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文件处理失败：{str(e)}")





from services.file_service import save_upload_entry, process_file_safe

@router.post("/extract/{file_id}")
async def extract_data(
    file_id: str, 
    force: bool = False, 
    db: AsyncSession = Depends(get_db)
):
    """
    Synchronous Extraction with Scoped Session.
    Waits for result to return data to Frontend, but uses isolated DB session to prevent errors.
    """
    
    # 1. Validate File Existence
    if file_id not in uploaded_files_store:
        raise HTTPException(
            status_code=404, 
            detail="File session expired. Please re-upload."
        )
    
    file_info = uploaded_files_store[file_id]
    content = file_info.get("content", "")
    images = file_info.get("images", [])
    if not images: images = file_info.get("image_paths", [])
    file_hash = file_info.get("file_hash")
    filename = file_info.get("filename", "Untitled")
    
    try:
        # 2. Check Cache / Create Pending Record (Synchronous DB Op)
        lit_record = await save_upload_entry(db, filename, content, file_hash)
        
        # 3. Process Safely (Synchronous Wait, Isolated Session)
        print(f"[Extraction] Starting safe processing for Lit ID: {lit_record.id}")
        
        # This will WAIT for extraction to finish
        metadata, data_list = await process_file_safe(
            file_id=lit_record.id, 
            content=content, 
            images=images, 
            force=force
        )
        
        # 4. Construct Response
        if data_list:
            # Construct LiteratureMetadata object
            from models.tribology import LiteratureMetadata
            # Ensure mandatory fields or use defaults
            meta_obj = LiteratureMetadata(
                title=metadata.get("title", filename),
                doi=metadata.get("doi", ""),
                authors=metadata.get("authors", ""),
                journal=metadata.get("journal", ""),
                year=metadata.get("year", 0),
                volume=metadata.get("volume"),
                issue=metadata.get("issue"),
                pages=metadata.get("pages"),
                issn=metadata.get("issn"),
                file_hash=file_hash,
                fileHash=file_hash
            )
            
            # Update Memory Store (for consistency)
            extracted_data_store[file_id] = {
                "metadata": metadata,
                "data": data_list
            }
            
            return {
                "success": True,
                "metadata": meta_obj,
                "data": data_list,
                "message": f"Successfully extracted {len(data_list)} records."
            }
        else:
             return {
                "success": False,
                "metadata": {},
                "data": [],
                "message": "No data extracted or processing failed."
            }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


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
    
    response = await llm_service.chat(request.message, context)
    
    return {
        "success": True,
        "response": response
    }
