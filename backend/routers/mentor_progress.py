from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter


router = APIRouter(prefix="/api/mentor", tags=["mentor"])


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.get("/progress")
async def get_mentor_progress():
    now = _utc_now()
    return {
        "window_days": 7,
        "progress_overview": {
            "stages": [
                {
                    "key": "verified_records",
                    "label": "Verified Records",
                    "total": 0,
                    "delta_count": 0,
                    "last_updated_at": None,
                    "description": "Verified records promoted from extraction results into trusted research memory.",
                },
                {
                    "key": "training_ready_outputs",
                    "label": "Training Ready Outputs",
                    "total": 0,
                    "delta_count": 0,
                    "last_updated_at": None,
                    "description": "Curated datasets that are ready for modeling and downstream evaluation.",
                },
            ],
        },
        "progress_deltas": {
            "dashboard": [
                {
                    "key": "verified_records",
                    "label": "Verified Records",
                    "baseline_label": "7 days ago",
                    "current_label": "Now",
                    "baseline_value": 0,
                    "current_value": 0,
                    "change_value": 0,
                    "unit": "records",
                    "trend": "flat",
                    "description": "No verified record delta has been computed in this restored environment yet.",
                },
                {
                    "key": "training_ready_outputs",
                    "label": "Training Ready Outputs",
                    "baseline_label": "7 days ago",
                    "current_label": "Now",
                    "baseline_value": 0,
                    "current_value": 0,
                    "change_value": 0,
                    "unit": "outputs",
                    "trend": "flat",
                    "description": "No training-ready output delta has been computed in this restored environment yet.",
                },
            ],
        },
        "timeline": [
            {
                "id": "mentor-bootstrap",
                "kind": "system",
                "title": "Mentor progress restored",
                "detail": "The mentor progress API is available again with a fallback payload.",
                "timestamp": now,
                "resource_type": "system",
                "resource_id": None,
                "literature_id": None,
                "dataset_id": None,
            },
        ],
        "quick_links": {
            "latest_processed_paper": None,
            "latest_verified_record": None,
            "latest_output": None,
        },
        "latest_ready_dataset": None,
        "cleaning_summary": None,
    }
