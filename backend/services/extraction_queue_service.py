from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select

from database import async_session_maker
from models.db_models import ExtractionRun, Literature
from services.extraction_trace_service import (
    create_extraction_run,
    finalize_extraction_run,
    get_extraction_run,
    mark_extraction_run_started,
)
from services.file_service import process_file_background

logger = logging.getLogger(__name__)


def _normalize_queue_profile(value: Any) -> str:
    normalized = str(value or "auto").strip().lower()
    if normalized in {"auto", "standard", "high_accuracy", "review_figure_estimate"}:
        return normalized
    return "auto"


@dataclass(slots=True)
class ExtractionQueueJob:
    literature_id: int
    extractor_type: str
    force: bool
    profile: str
    strict_cof_mode: bool | None
    run_id: str
    created_at: datetime

    @property
    def key(self) -> tuple[int, str]:
        return (self.literature_id, self.extractor_type)


class ExtractionQueueService:
    def __init__(self) -> None:
        self._queue: asyncio.Queue[ExtractionQueueJob] = asyncio.Queue()
        self._workers: list[asyncio.Task[None]] = []
        self._lock = asyncio.Lock()
        self._jobs_by_key: dict[tuple[int, str], ExtractionQueueJob] = {}
        self._queued_order: list[tuple[int, str]] = []
        self._active_keys: set[tuple[int, str]] = set()
        self._active_tasks: dict[tuple[int, str], asyncio.Task[None]] = {}
        self._stopping = False

    async def start(self) -> None:
        if self._workers:
            return
        self._stopping = False
        worker_count = max(1, int(os.getenv("EXTRACTION_WORKER_COUNT", "1") or "1"))
        await self.recover_pending_jobs()
        for index in range(worker_count):
            self._workers.append(asyncio.create_task(self._worker(index + 1)))
        logger.info("Extraction queue started with %s worker(s)", worker_count)

    async def stop(self) -> None:
        self._stopping = True
        for worker in self._workers:
            worker.cancel()
        if self._workers:
            await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()
        logger.info("Extraction queue stopped")

    async def enqueue(
        self,
        *,
        literature_id: int,
        extractor_type: str = "tribology",
        force: bool = False,
        profile: str = "auto",
        strict_cof_mode: bool | None = None,
    ) -> dict[str, Any]:
        extractor_type = "diffusion" if extractor_type == "diffusion" else "tribology"
        profile = _normalize_queue_profile(profile)

        key = (literature_id, extractor_type)
        async with self._lock:
            existing = self._jobs_by_key.get(key)
            if existing:
                return self._snapshot(existing, "already_queued")

            job = ExtractionQueueJob(
                literature_id=literature_id,
                extractor_type=extractor_type,
                force=force,
                profile=profile,
                strict_cof_mode=strict_cof_mode,
                run_id=uuid.uuid4().hex,
                created_at=datetime.utcnow(),
            )
            self._jobs_by_key[key] = job
            self._queued_order.append(key)

        try:
            await self._create_queued_run(job)
        except Exception:
            async with self._lock:
                if self._jobs_by_key.get(key) is job:
                    self._jobs_by_key.pop(key, None)
                    self._queued_order = [item for item in self._queued_order if item != key]
            raise

        await self._queue.put(job)
        return self._snapshot(job, "queued")

    async def cancel(self, *, literature_id: int, extractor_type: str = "tribology") -> dict[str, Any]:
        extractor_type = "diffusion" if extractor_type == "diffusion" else "tribology"
        key = (literature_id, extractor_type)
        async with self._lock:
            job = self._jobs_by_key.get(key)
            was_queued = key in self._queued_order
            was_active = key in self._active_keys
            task = self._active_tasks.get(key)

            if was_queued:
                self._jobs_by_key.pop(key, None)
                self._queued_order = [item for item in self._queued_order if item != key]
            elif was_active and job:
                if self._jobs_by_key.get(key) is job:
                    self._jobs_by_key.pop(key, None)

            cancelled_task = False
            if task and not task.done():
                task.cancel()
                cancelled_task = True

            return {
                "cancelled": bool(job or was_queued or was_active or cancelled_task),
                "literature_id": literature_id,
                "extractor_type": extractor_type,
                "run_id": getattr(job, "run_id", None),
                "queued": was_queued,
                "active": was_active,
                "task_cancelled": cancelled_task,
            }

    async def recover_pending_jobs(self) -> int:
        active_statuses = {"queued", "running", "processing", "extracting"}
        async with async_session_maker() as db:
            rows = (
                await db.execute(
                    select(ExtractionRun)
                    .where(ExtractionRun.status.in_(active_statuses))
                    .order_by(ExtractionRun.id.asc())
                )
            ).scalars().all()

        latest_by_key: dict[tuple[int, str], ExtractionRun] = {}
        for run in rows:
            latest_by_key[(run.literature_id, run.extractor_type or "tribology")] = run

        recovered = 0
        for run in latest_by_key.values():
            job = ExtractionQueueJob(
                literature_id=run.literature_id,
                extractor_type="diffusion" if run.extractor_type == "diffusion" else "tribology",
                force=True,
                profile=_normalize_queue_profile(run.profile),
                strict_cof_mode=None,
                run_id=run.run_id,
                created_at=datetime.utcnow(),
            )
            async with self._lock:
                if job.key in self._jobs_by_key:
                    continue
                self._jobs_by_key[job.key] = job
                self._queued_order.append(job.key)
            await self._queue.put(job)
            recovered += 1

        if recovered:
            logger.info("Recovered %s pending extraction job(s)", recovered)
        return recovered

    def _snapshot(self, job: ExtractionQueueJob, status: str) -> dict[str, Any]:
        try:
            queue_position = self._queued_order.index(job.key) + 1
        except ValueError:
            queue_position = 0 if job.key in self._active_keys else None
        return {
            "status": status,
            "run_id": job.run_id,
            "literature_id": job.literature_id,
            "extractor_type": job.extractor_type,
            "profile": job.profile,
            "queue_position": queue_position,
            "active": job.key in self._active_keys,
        }

    async def _create_queued_run(self, job: ExtractionQueueJob) -> None:
        async with async_session_maker() as db:
            literature = await db.get(Literature, job.literature_id)
            if not literature:
                raise ValueError(f"Literature {job.literature_id} not found")

            literature.status = "queued"
            literature.error_message = None
            summary = {
                "run_id": job.run_id,
                "extractor_type": job.extractor_type,
                "profile": job.profile,
                "current_stage": "stage_a.queued",
                "current_message": "Extraction queued. Waiting for the background worker.",
                "progress_log": [
                    {
                        "stage": "stage_a.queued",
                        "message": "Extraction queued. Waiting for the background worker.",
                    }
                ],
                "queue_position": self._snapshot(job, "queued").get("queue_position"),
            }
            await create_extraction_run(
                db,
                run_id=job.run_id,
                literature_id=job.literature_id,
                extractor_type=job.extractor_type,
                profile=job.profile,
                status="queued",
                summary=summary,
            )
            await db.commit()

    async def _mark_failed(self, job: ExtractionQueueJob, error: BaseException) -> None:
        message = str(error) or error.__class__.__name__
        async with async_session_maker() as db:
            literature = await db.get(Literature, job.literature_id)
            if literature:
                literature.status = "failed"
                literature.error_message = message
            if await get_extraction_run(db, job.run_id):
                summary = {
                    "run_id": job.run_id,
                    "extractor_type": job.extractor_type,
                    "profile": job.profile,
                    "current_stage": "failed",
                    "current_message": message,
                    "progress_log": [{"stage": "failed", "message": message}],
                }
                await finalize_extraction_run(
                    db,
                    run_id=job.run_id,
                    status="failed",
                    candidate_count=0,
                    final_count=0,
                    dropped_by_reason={"worker_error": 1},
                    summary=summary,
                    error_message=message,
                )
            await db.commit()

    async def _worker(self, worker_id: int) -> None:
        while not self._stopping:
            job = await self._queue.get()
            while not self._stopping:
                async with self._lock:
                    if self._jobs_by_key.get(job.key) is not job:
                        self._queue.task_done()
                        break
                    if job.key not in self._active_keys:
                        self._queued_order = [item for item in self._queued_order if item != job.key]
                        self._active_keys.add(job.key)
                        break
                await asyncio.sleep(0.1)
            else:
                self._queue.task_done()
                continue

            async with self._lock:
                if self._jobs_by_key.get(job.key) is not job or job.key not in self._active_keys:
                    continue

            process_task: asyncio.Task[None] | None = None
            try:
                logger.info(
                    "Extraction worker %s starting literature_id=%s extractor=%s run_id=%s",
                    worker_id,
                    job.literature_id,
                    job.extractor_type,
                    job.run_id,
                )
                async with async_session_maker() as db:
                    await mark_extraction_run_started(
                        db,
                        run_id=job.run_id,
                        extractor_type=job.extractor_type,
                        profile=job.profile,
                    )
                    await db.commit()

                process_task = asyncio.create_task(
                    process_file_background(
                        job.literature_id,
                        extractor_type=job.extractor_type,
                        force=job.force,
                        profile=job.profile,
                        strict_cof_mode=job.strict_cof_mode,
                        run_id=job.run_id,
                    )
                )
                async with self._lock:
                    self._active_tasks[job.key] = process_task
                await process_task
            except asyncio.CancelledError:
                if self._stopping:
                    if process_task and not process_task.done():
                        process_task.cancel()
                    raise
                logger.info(
                    "Extraction worker %s cancelled active job literature_id=%s extractor=%s run_id=%s",
                    worker_id,
                    job.literature_id,
                    job.extractor_type,
                    job.run_id,
                )
            except Exception as exc:
                logger.exception(
                    "Extraction worker %s failed literature_id=%s extractor=%s run_id=%s",
                    worker_id,
                    job.literature_id,
                    job.extractor_type,
                    job.run_id,
                )
                await self._mark_failed(job, exc)
            finally:
                async with self._lock:
                    self._active_keys.discard(job.key)
                    if process_task and self._active_tasks.get(job.key) is process_task:
                        self._active_tasks.pop(job.key, None)
                    if self._jobs_by_key.get(job.key) is job:
                        self._jobs_by_key.pop(job.key, None)
                self._queue.task_done()


_queue_service = ExtractionQueueService()


def get_extraction_queue() -> ExtractionQueueService:
    return _queue_service
