import pytest
from fastapi import HTTPException
from sqlalchemy import select

from models.db_models import Literature, ResearchGroup, TribologyData, User
from routers.data_explorer import BatchDeletePayload, batch_delete_records
from security import AuthPrincipal


async def _seed_records(db_session, count: int):
    group = ResearchGroup(name="Batch Delete Group", slug="batch-delete-group")
    db_session.add(group)
    await db_session.flush()
    user = User(
        username="batch-delete-admin",
        display_name="Batch Delete Admin",
        password_hash="test",
        role="group_admin",
        group_id=group.id,
    )
    db_session.add(user)
    literature = Literature(
        doi="10.0000/batch-delete",
        title="Batch delete",
        authors="Test Author",
        journal="Test Journal",
        year=2026,
        group_id=group.id,
    )
    db_session.add(literature)
    await db_session.flush()

    records = []
    for index in range(count):
        record = TribologyData(
            literature_id=literature.id,
            material_name="Mica",
            lubricant="[BMIM][BF4]",
            cof_value=0.1 + index,
            cof_raw=str(0.1 + index),
            review_status="approved",
        )
        db_session.add(record)
        records.append(record)
    await db_session.flush()

    principal = AuthPrincipal(user=user, group=group, personal_workspace=None)
    return principal, records


@pytest.mark.anyio
async def test_batch_delete_removes_all_authorized_records(db_session):
    principal, records = await _seed_records(db_session, 3)
    ids = [record.id for record in records]

    result = await batch_delete_records(
        BatchDeletePayload(ids=ids),
        session=db_session,
        principal=principal,
    )

    assert result["success"] is True
    assert result["requested"] == 3
    assert result["deletedCount"] == 3
    assert sorted(result["deleted"]) == sorted(ids)
    assert result["failed"] == []

    remaining = (await db_session.execute(select(TribologyData.id))).scalars().all()
    assert remaining == []


@pytest.mark.anyio
async def test_batch_delete_reports_missing_ids_without_aborting(db_session):
    principal, records = await _seed_records(db_session, 2)
    valid_ids = [record.id for record in records]
    missing_id = max(valid_ids) + 999

    result = await batch_delete_records(
        BatchDeletePayload(ids=[valid_ids[0], missing_id, valid_ids[1], valid_ids[0]]),
        session=db_session,
        principal=principal,
    )

    # Duplicate id is de-duplicated; the missing id is reported, valid ones deleted.
    assert result["requested"] == 3
    assert result["deletedCount"] == 2
    assert sorted(result["deleted"]) == sorted(valid_ids)
    assert [entry["id"] for entry in result["failed"]] == [missing_id]

    remaining = (await db_session.execute(select(TribologyData.id))).scalars().all()
    assert remaining == []


@pytest.mark.anyio
async def test_batch_delete_rejects_empty_payload(db_session):
    principal, _ = await _seed_records(db_session, 1)
    with pytest.raises(HTTPException) as excinfo:
        await batch_delete_records(
            BatchDeletePayload(ids=[]),
            session=db_session,
            principal=principal,
        )
    assert excinfo.value.status_code == 400
