import asyncio
import json
import traceback
from datetime import datetime

from sqlalchemy import select

from database import async_session_maker
from models.db_models import Literature
from services.file_service import process_file_safe


def log(message: str) -> None:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {message}", flush=True)


async def load_group_literature_ids() -> list[int]:
    async with async_session_maker() as db:
        result = await db.execute(
            select(Literature.id)
            .where(
                Literature.scope_type == "group_library",
                Literature.scope_key == "group_library",
            )
            .order_by(Literature.id)
        )
        return [int(item) for item in result.scalars().all()]


async def main() -> None:
    literature_ids = await load_group_literature_ids()
    log(f"GROUP_REEXTRACT_START count={len(literature_ids)} ids={literature_ids}")
    failures: list[dict[str, str | int]] = []

    for index, literature_id in enumerate(literature_ids, start=1):
        log(f"START {index}/{len(literature_ids)} literature_id={literature_id}")
        try:
            metadata, data, summary = await process_file_safe(
                literature_id,
                force=True,
                profile="high_accuracy",
                strict_cof_mode=True,
            )
            log(
                "DONE "
                + json.dumps(
                    {
                        "literature_id": literature_id,
                        "records": len(data or []),
                        "metadata_title": (metadata or {}).get("title"),
                        "summary": summary or {},
                    },
                    ensure_ascii=False,
                    default=str,
                )
            )
        except Exception as exc:
            failures.append({"literature_id": literature_id, "error": str(exc)})
            log(f"FAILED literature_id={literature_id} error={exc}")
            traceback.print_exc()

    log("GROUP_REEXTRACT_FINISH " + json.dumps({"failures": failures}, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
