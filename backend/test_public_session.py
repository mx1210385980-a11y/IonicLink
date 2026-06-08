import pytest

from models import db_models as _db_models  # noqa: F401


@pytest.mark.anyio
async def test_public_session_returns_researcher_workspace_scope(async_client):
    response = await async_client.post("/api/auth/public-session")

    assert response.status_code == 200
    payload = response.json()
    assert payload["accessToken"]
    assert payload["tokenType"] == "bearer"
    assert payload["user"]["username"] == "public-extractor"
    assert payload["user"]["role"] == "researcher"
    assert payload["user"]["personalWorkspaceId"]
    assert any(scope["type"] == "workspace" and scope["writable"] for scope in payload["user"]["availableScopes"])
    assert any(scope["label"] == "Public Account" for scope in payload["user"]["availableScopes"])
    assert all("Workspace" not in scope["label"] for scope in payload["user"]["availableScopes"])


@pytest.mark.anyio
async def test_public_session_token_can_read_current_user(async_client):
    session_response = await async_client.post("/api/auth/public-session")
    token = session_response.json()["accessToken"]

    response = await async_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["username"] == "public-extractor"
