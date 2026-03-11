from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from services.file_service import process_file_safe, reprocess_literature


class MediaWorkflowService:
    async def extract_document(
        self,
        *,
        file_id: int,
        force: bool = False,
        profile: str = "high_accuracy",
        strict_cof_mode: Optional[bool] = None,
    ) -> dict[str, Any]:
        metadata, data, extraction_summary = await process_file_safe(
            file_id=file_id,
            force=force,
            profile=profile,
            strict_cof_mode=strict_cof_mode,
        )
        return {
            "metadata": metadata or {},
            "data": data or [],
            "extraction_summary": extraction_summary or {},
        }

    async def reprocess_document(
        self,
        *,
        literature_id: int,
        db: AsyncSession,
        file_content: str | None = None,
    ) -> dict[str, Any]:
        return await reprocess_literature(
            literature_id=literature_id,
            db=db,
            file_content=file_content,
        )
