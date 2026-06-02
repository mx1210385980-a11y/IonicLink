import asyncio
import contextlib
from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import services.extraction_queue_service as queue_module
from models.db_models import ExtractionRun, Literature
from services.extraction_queue_service import ExtractionQueueJob, ExtractionQueueService


def _job(literature_id: int = 124, extractor_type: str = "tribology") -> ExtractionQueueJob:
    return ExtractionQueueJob(
        literature_id=literature_id,
        extractor_type=extractor_type,
        force=False,
        profile="standard",
        strict_cof_mode=None,
        run_id=f"{extractor_type}-run",
        created_at=datetime.utcnow(),
    )


@pytest.mark.anyio
async def test_cancel_pending_extraction_queue_job_removes_it_from_tracking():
    service = ExtractionQueueService()
    job = _job()
    await service._queue.put(job)
    service._jobs_by_key[job.key] = job
    service._queued_order.append(job.key)

    snapshot = await service.cancel(literature_id=job.literature_id, extractor_type=job.extractor_type)

    assert snapshot["cancelled"] is True
    assert snapshot["active"] is False
    assert snapshot["queued"] is True
    assert job.key not in service._jobs_by_key
    assert job.key not in service._queued_order


@pytest.mark.anyio
async def test_cancel_active_extraction_queue_job_cancels_running_task():
    service = ExtractionQueueService()
    job = _job()
    started = asyncio.Event()

    async def long_running_job():
        started.set()
        await asyncio.sleep(60)

    task = asyncio.create_task(long_running_job())
    await started.wait()
    service._jobs_by_key[job.key] = job
    service._active_keys.add(job.key)
    service._active_tasks[job.key] = task

    snapshot = await service.cancel(literature_id=job.literature_id, extractor_type=job.extractor_type)
    await asyncio.sleep(0)

    assert snapshot["cancelled"] is True
    assert snapshot["active"] is True
    assert task.cancelled()


@pytest.mark.anyio
async def test_enqueue_after_active_cancel_does_not_reuse_cancelled_run(monkeypatch):
    service = ExtractionQueueService()
    job = _job()
    started = asyncio.Event()

    async def long_running_job():
        started.set()
        await asyncio.sleep(60)

    task = asyncio.create_task(long_running_job())
    await started.wait()
    service._jobs_by_key[job.key] = job
    service._active_keys.add(job.key)
    service._active_tasks[job.key] = task

    await service.cancel(literature_id=job.literature_id, extractor_type=job.extractor_type)

    created_run_ids: list[str] = []

    async def fake_create_queued_run(next_job: ExtractionQueueJob):
        created_run_ids.append(next_job.run_id)

    monkeypatch.setattr(service, "_create_queued_run", fake_create_queued_run)

    retry = await service.enqueue(
        literature_id=job.literature_id,
        extractor_type=job.extractor_type,
        force=True,
        profile=job.profile,
    )

    assert retry["status"] == "queued"
    assert retry["run_id"] != job.run_id
    assert created_run_ids == [retry["run_id"]]

    await asyncio.gather(task, return_exceptions=True)


@pytest.mark.anyio
async def test_retry_after_active_cancel_waits_for_old_worker_before_processing(monkeypatch):
    service = ExtractionQueueService()
    job = _job()
    starts: list[str] = []
    active_count = 0
    max_active_count = 0
    first_started = asyncio.Event()
    second_started = asyncio.Event()
    second_can_finish = asyncio.Event()

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return None

        async def commit(self):
            return None

    async def fake_create_queued_run(_job: ExtractionQueueJob):
        return None

    async def fake_mark_started(*_args, **_kwargs):
        return None

    async def fake_process_file_background(literature_id: int, *, extractor_type: str, run_id: str, **_kwargs):
        nonlocal active_count, max_active_count
        assert (literature_id, extractor_type) == job.key
        starts.append(run_id)
        active_count += 1
        max_active_count = max(max_active_count, active_count)
        if len(starts) == 1:
            first_started.set()
        else:
            second_started.set()
        try:
            if len(starts) == 1:
                await asyncio.Future()
            else:
                await second_can_finish.wait()
        except asyncio.CancelledError:
            await asyncio.sleep(0.15)
            raise
        finally:
            active_count -= 1

    monkeypatch.setattr(service, "_create_queued_run", fake_create_queued_run)
    monkeypatch.setattr(queue_module, "async_session_maker", lambda: FakeSession())
    monkeypatch.setattr(queue_module, "mark_extraction_run_started", fake_mark_started)
    monkeypatch.setattr(queue_module, "process_file_background", fake_process_file_background)

    worker_one = asyncio.create_task(service._worker(1))
    worker_two = asyncio.create_task(service._worker(2))
    try:
        first = await service.enqueue(
            literature_id=job.literature_id,
            extractor_type=job.extractor_type,
            force=True,
            profile=job.profile,
        )
        await asyncio.wait_for(first_started.wait(), timeout=1)

        await service.cancel(literature_id=job.literature_id, extractor_type=job.extractor_type)
        retry = await service.enqueue(
            literature_id=job.literature_id,
            extractor_type=job.extractor_type,
            force=True,
            profile=job.profile,
        )
        await asyncio.wait_for(second_started.wait(), timeout=1)
        second_can_finish.set()
        await asyncio.wait_for(service._queue.join(), timeout=1)

        assert retry["run_id"] != first["run_id"]
        assert starts == [first["run_id"], retry["run_id"]]
        assert max_active_count == 1
    finally:
        worker_one.cancel()
        worker_two.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await worker_one
        with contextlib.suppress(asyncio.CancelledError):
            await worker_two


@pytest.mark.anyio
async def test_enqueue_persists_queued_run_for_unextracted_literature(test_engine, monkeypatch):
    session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(queue_module, "async_session_maker", session_factory)
    async with session_factory() as session:
        literature = Literature(
            doi="temp-unextracted-queue-test",
            title="Unextracted Queue Test",
            authors="",
            journal="",
            year=2026,
            status="pending",
        )
        session.add(literature)
        await session.commit()
        literature_id = literature.id

    service = ExtractionQueueService()
    snapshot = await service.enqueue(
        literature_id=literature_id,
        extractor_type="tribology",
        force=True,
        profile="standard",
    )

    assert snapshot["status"] == "queued"
    assert snapshot["queue_position"] == 1
    async with session_factory() as session:
        literature = await session.get(Literature, literature_id)
        run = (
            await session.execute(
                select(ExtractionRun).where(ExtractionRun.literature_id == literature_id)
            )
        ).scalar_one()

    assert literature is not None
    assert literature.status == "queued"
    assert run.status == "queued"
    assert run.extractor_type == "tribology"
    assert "Waiting for the background worker" in (run.summary_json or "")


@pytest.mark.anyio
async def test_recover_pending_jobs_requeues_database_runs_after_worker_restart(test_engine, monkeypatch):
    session_factory = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(queue_module, "async_session_maker", session_factory)
    async with session_factory() as session:
        literature = Literature(
            doi="temp-recover-queue-test",
            title="Recover Queue Test",
            authors="",
            journal="",
            year=2026,
            status="queued",
        )
        session.add(literature)
        await session.flush()
        literature_id = literature.id
        session.add(
            ExtractionRun(
                run_id="recover-queued-run",
                literature_id=literature_id,
                extractor_type="diffusion",
                profile="standard",
                status="queued",
            )
        )
        await session.commit()

    service = ExtractionQueueService()
    recovered = await service.recover_pending_jobs()

    assert recovered == 1
    snapshot = await service.enqueue(
        literature_id=literature_id,
        extractor_type="diffusion",
        force=True,
        profile="standard",
    )
    assert snapshot["status"] == "already_queued"
    assert snapshot["run_id"] == "recover-queued-run"
