from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db_session
from models.db_models import (
    CleanedDataset,
    DiffusionCandidate,
    DiffusionRecord,
    Literature,
    RecordCandidate,
    ResearchGroup,
    TribologyData,
    User,
    Workspace,
)

ROLE_PRINCIPAL_INVESTIGATOR = "principal_investigator"
ROLE_GROUP_ADMIN = "group_admin"
ROLE_RESEARCHER = "researcher"
ROLE_WORKSPACE_RESEARCHER = "workspace_researcher"
ROLE_VIEWER = "viewer"

ADMIN_ROLES = {ROLE_PRINCIPAL_INVESTIGATOR, ROLE_GROUP_ADMIN}
WORKSPACE_WRITE_ROLES = {ROLE_PRINCIPAL_INVESTIGATOR, ROLE_GROUP_ADMIN, ROLE_RESEARCHER, ROLE_WORKSPACE_RESEARCHER}
GROUP_LIBRARY_WRITE_ROLES = {ROLE_PRINCIPAL_INVESTIGATOR, ROLE_GROUP_ADMIN, ROLE_RESEARCHER}
ALL_ROLES = {
    ROLE_PRINCIPAL_INVESTIGATOR,
    ROLE_GROUP_ADMIN,
    ROLE_RESEARCHER,
    ROLE_WORKSPACE_RESEARCHER,
    ROLE_VIEWER,
}

JWT_SECRET = os.getenv("JWT_SECRET", "ioniclink-dev-secret-change-me")
JWT_TTL_MINUTES = max(5, int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "720")))

DEFAULT_GROUP_NAME = os.getenv("IONICLINK_GROUP_NAME", "IonicLink Research Group")
DEFAULT_GROUP_SLUG = os.getenv("IONICLINK_GROUP_SLUG", "ioniclink-research-group")
DEFAULT_ADMIN_USERNAME = os.getenv("IONICLINK_ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_DISPLAY_NAME = os.getenv("IONICLINK_ADMIN_DISPLAY_NAME", "Group Admin")
EXAMPLE_ADMIN_PASSWORD = "ChangeMe123!"
DEFAULT_ADMIN_PASSWORD = os.getenv("IONICLINK_ADMIN_PASSWORD", "")
DEFAULT_PUBLIC_USERNAME = os.getenv("IONICLINK_PUBLIC_USERNAME", "public-extractor")
DEFAULT_PUBLIC_DISPLAY_NAME = os.getenv("IONICLINK_PUBLIC_DISPLAY_NAME", "IonicLink Extraction")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def validate_bootstrap_admin_password(password: str | None) -> None:
    if not password or password == EXAMPLE_ADMIN_PASSWORD:
        raise RuntimeError(
            "IONICLINK_ADMIN_PASSWORD must be set to a non-example value before bootstrapping the admin user."
        )


@dataclass(slots=True)
class AuthPrincipal:
    user: User
    group: ResearchGroup
    personal_workspace: Workspace | None


@dataclass(slots=True)
class RequestScope:
    scope_type: str
    group_id: int
    scope_key: str
    workspace: Workspace | None = None


def slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", str(value or "").strip().lower())
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    return normalized or "workspace"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    iterations = 600_000
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256${iterations}${salt}${digest}".format(
        iterations=iterations,
        salt=base64.urlsafe_b64encode(salt).decode("ascii"),
        digest=base64.urlsafe_b64encode(derived).decode("ascii"),
    )


def verify_password(password: str, password_hash: str) -> bool:
    try:
        scheme, iterations_raw, salt_raw, digest_raw = str(password_hash or "").split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iterations_raw)
        salt = base64.urlsafe_b64decode(salt_raw.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_raw.encode("ascii"))
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(candidate, expected)
    except Exception:
        return False


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(token: str) -> bytes:
    padding = "=" * (-len(token) % 4)
    return base64.urlsafe_b64decode((token + padding).encode("ascii"))


def encode_token(payload: dict[str, Any]) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    encoded_header = _b64url_encode(json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    encoded_payload = _b64url_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{encoded_header}.{encoded_payload}.{_b64url_encode(signature)}"


def decode_token(token: str) -> dict[str, Any]:
    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".", 2)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token format") from exc

    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    expected_signature = hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
    actual_signature = _b64url_decode(encoded_signature)
    if not hmac.compare_digest(expected_signature, actual_signature):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token signature")

    try:
        payload = json.loads(_b64url_decode(encoded_payload))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload") from exc

    expires_at = int(payload.get("exp") or 0)
    now_ts = int(datetime.now(timezone.utc).timestamp())
    if expires_at <= now_ts:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    return payload


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=JWT_TTL_MINUTES)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "group_id": user.group_id,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return encode_token(payload)


def build_scope_key(scope_type: str, workspace_id: int | None = None) -> str:
    if scope_type == "group_library":
        return "group_library"
    if not workspace_id:
        raise ValueError("workspace_id is required for workspace scope")
    return f"workspace:{workspace_id}"


def scope_filters(scope: RequestScope) -> dict[str, Any]:
    return {
        "group_id": scope.group_id,
        "scope_type": scope.scope_type,
        "scope_key": scope.scope_key,
        "workspace_id": scope.workspace.id if scope.workspace else None,
    }


def literature_scope_conditions(filters: dict[str, Any]):
    if filters["scope_type"] == "all_visible":
        return [
            Literature.group_id == filters["group_id"],
        ]
    conditions = [
        Literature.group_id == filters["group_id"],
        Literature.scope_type == filters["scope_type"],
        Literature.scope_key == filters["scope_key"],
    ]
    if filters["scope_type"] == "workspace":
        conditions.append(Literature.workspace_id == filters["workspace_id"])
    else:
        conditions.append(Literature.workspace_id.is_(None))
    return conditions


def is_admin(principal: AuthPrincipal) -> bool:
    return principal.user.role in ADMIN_ROLES


def can_view_workspace(principal: AuthPrincipal, workspace: Workspace | None) -> bool:
    if workspace is None or workspace.group_id != principal.group.id:
        return False
    if is_admin(principal):
        return True
    return workspace.owner_user_id == principal.user.id


def can_write_scope(principal: AuthPrincipal, scope: RequestScope) -> bool:
    if scope.scope_type == "group_library":
        return principal.user.role in GROUP_LIBRARY_WRITE_ROLES
    if scope.workspace is None:
        return False
    if is_admin(principal):
        return True
    return scope.workspace.owner_user_id == principal.user.id and principal.user.role in WORKSPACE_WRITE_ROLES


def can_view_literature(principal: AuthPrincipal, literature: Literature | None) -> bool:
    if literature is None or literature.group_id != principal.group.id:
        return False
    if is_admin(principal):
        return True
    if literature.scope_type == "group_library":
        return True
    return literature.workspace_id == getattr(principal.personal_workspace, "id", None)


def can_manage_literature(principal: AuthPrincipal, literature: Literature | None) -> bool:
    if literature is None or literature.group_id != principal.group.id:
        return False
    if is_admin(principal):
        return True
    if principal.user.role not in WORKSPACE_WRITE_ROLES:
        return False
    if literature.scope_type == "workspace":
        return literature.workspace_id == getattr(principal.personal_workspace, "id", None)
    return literature.created_by_user_id == principal.user.id


def can_view_cleaned_dataset(principal: AuthPrincipal, dataset: CleanedDataset | None) -> bool:
    if dataset is None or dataset.group_id != principal.group.id:
        return False
    if is_admin(principal):
        return True
    if dataset.scope_type == "group_library":
        return True
    return dataset.workspace_id == getattr(principal.personal_workspace, "id", None)


def can_manage_cleaned_dataset(principal: AuthPrincipal, dataset: CleanedDataset | None) -> bool:
    if dataset is None or dataset.group_id != principal.group.id:
        return False
    if is_admin(principal):
        return True
    if principal.user.role not in WORKSPACE_WRITE_ROLES:
        return False
    if dataset.scope_type == "workspace":
        return dataset.workspace_id == getattr(principal.personal_workspace, "id", None)
    return dataset.created_by_user_id == principal.user.id


def ensure_scope_writable(principal: AuthPrincipal, scope: RequestScope) -> None:
    if not can_write_scope(principal, scope):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have write access to this scope")


async def get_current_principal(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db_session),
) -> AuthPrincipal:
    payload = decode_token(token)
    try:
        user_id = int(payload.get("sub") or 0)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject") from exc

    stmt = (
        select(User)
        .options(selectinload(User.group), selectinload(User.workspaces))
        .where(User.id == user_id)
    )
    user = (await db.execute(stmt)).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    if not user.group:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is not assigned to a research group")

    personal_workspace = next((workspace for workspace in user.workspaces if workspace.is_personal), None)
    return AuthPrincipal(user=user, group=user.group, personal_workspace=personal_workspace)


async def get_request_scope(
    principal: AuthPrincipal = Depends(get_current_principal),
    db: AsyncSession = Depends(get_db_session),
    x_scope_type: str | None = Header(None, alias="X-Scope-Type"),
    x_workspace_id: str | None = Header(None, alias="X-Workspace-Id"),
) -> RequestScope:
    requested_scope = str(x_scope_type or "group_library").strip().lower()
    if requested_scope == "group_library":
        return RequestScope(
            scope_type="group_library",
            group_id=principal.group.id,
            scope_key=build_scope_key("group_library"),
        )

    workspace_id = None
    if x_workspace_id:
        try:
            workspace_id = int(x_workspace_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid workspace id") from exc
    elif principal.personal_workspace:
        workspace_id = principal.personal_workspace.id

    if not workspace_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Workspace scope requires a workspace id")

    workspace = await db.get(Workspace, workspace_id)
    if not workspace or workspace.group_id != principal.group.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")
    if not can_view_workspace(principal, workspace):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to this workspace")

    return RequestScope(
        scope_type="workspace",
        group_id=principal.group.id,
        scope_key=build_scope_key("workspace", workspace.id),
        workspace=workspace,
    )


async def require_literature_access(
    db: AsyncSession,
    principal: AuthPrincipal,
    literature_id: int,
    *,
    write: bool = False,
) -> Literature:
    stmt = (
        select(Literature)
        .options(selectinload(Literature.workspace), selectinload(Literature.created_by))
        .where(Literature.id == literature_id)
    )
    literature = (await db.execute(stmt)).scalar_one_or_none()
    if not literature or not can_view_literature(principal, literature):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Literature not found")
    if write and not can_manage_literature(principal, literature):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to modify this literature")
    return literature


async def require_record_access(
    db: AsyncSession,
    principal: AuthPrincipal,
    record_id: int,
    *,
    write: bool = False,
) -> TribologyData:
    stmt = (
        select(TribologyData)
        .options(selectinload(TribologyData.literature))
        .where(TribologyData.id == record_id)
    )
    record = (await db.execute(stmt)).scalar_one_or_none()
    if not record or not can_view_literature(principal, record.literature):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")
    if write and not can_manage_literature(principal, record.literature):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to modify this record")
    return record


async def require_candidate_access(
    db: AsyncSession,
    principal: AuthPrincipal,
    candidate_id: int,
    *,
    write: bool = False,
) -> RecordCandidate:
    stmt = (
        select(RecordCandidate)
        .options(selectinload(RecordCandidate.literature), selectinload(RecordCandidate.promoted_record))
        .where(RecordCandidate.id == candidate_id)
    )
    candidate = (await db.execute(stmt)).scalar_one_or_none()
    if not candidate or not can_view_literature(principal, candidate.literature):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    if write and not can_manage_literature(principal, candidate.literature):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to modify this candidate")
    return candidate


async def require_diffusion_record_access(
    db: AsyncSession,
    principal: AuthPrincipal,
    record_id: int,
    *,
    write: bool = False,
) -> DiffusionRecord:
    stmt = (
        select(DiffusionRecord)
        .options(selectinload(DiffusionRecord.literature))
        .where(DiffusionRecord.id == record_id)
    )
    record = (await db.execute(stmt)).scalar_one_or_none()
    if not record or not can_view_literature(principal, record.literature):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Diffusion record not found")
    if write and not can_manage_literature(principal, record.literature):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to modify this diffusion record")
    return record


async def require_diffusion_candidate_access(
    db: AsyncSession,
    principal: AuthPrincipal,
    candidate_id: int,
    *,
    write: bool = False,
) -> DiffusionCandidate:
    stmt = (
        select(DiffusionCandidate)
        .options(selectinload(DiffusionCandidate.literature), selectinload(DiffusionCandidate.promoted_record))
        .where(DiffusionCandidate.id == candidate_id)
    )
    candidate = (await db.execute(stmt)).scalar_one_or_none()
    if not candidate or not can_view_literature(principal, candidate.literature):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Diffusion candidate not found")
    if write and not can_manage_literature(principal, candidate.literature):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to modify this diffusion candidate")
    return candidate


async def require_cleaned_dataset_access(
    db: AsyncSession,
    principal: AuthPrincipal,
    dataset_id: int,
    *,
    write: bool = False,
) -> CleanedDataset:
    dataset = await db.get(CleanedDataset, dataset_id)
    if not dataset or not can_view_cleaned_dataset(principal, dataset):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cleaned dataset not found")
    if write and not can_manage_cleaned_dataset(principal, dataset):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to modify this cleaned dataset")
    return dataset


async def list_accessible_workspaces(db: AsyncSession, principal: AuthPrincipal) -> list[Workspace]:
    stmt = select(Workspace).where(Workspace.group_id == principal.group.id).order_by(Workspace.is_personal.desc(), Workspace.name)
    if not is_admin(principal):
        stmt = stmt.where(Workspace.owner_user_id == principal.user.id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def ensure_personal_workspace(
    db: AsyncSession,
    user: User,
    *,
    name: str | None = None,
    description: str | None = None,
) -> Workspace:
    stmt = select(Workspace).where(
        Workspace.group_id == user.group_id,
        Workspace.owner_user_id == user.id,
        Workspace.is_personal.is_(True),
    )
    workspace = (await db.execute(stmt)).scalar_one_or_none()
    if workspace:
        return workspace

    display_name = str(name or f"{user.display_name} Workspace").strip() or f"{user.username} Workspace"
    slug = slugify(f"{user.username}-workspace")
    workspace = Workspace(
        group_id=user.group_id,
        owner_user_id=user.id,
        name=display_name,
        slug=slug,
        description=description or "Personal research workspace",
        is_personal=True,
    )
    db.add(workspace)
    await db.flush()
    return workspace


def scope_summary_from_workspace(principal: AuthPrincipal, workspace: Workspace) -> dict[str, Any]:
    return {
        "type": "workspace",
        "key": build_scope_key("workspace", workspace.id),
        "label": workspace.name,
        "workspaceId": workspace.id,
        "ownerUserId": workspace.owner_user_id,
        "isPersonal": bool(workspace.is_personal),
        "writable": bool(
            is_admin(principal)
            or (workspace.owner_user_id == principal.user.id and principal.user.role in WORKSPACE_WRITE_ROLES)
        ),
    }


def group_library_scope_summary(principal: AuthPrincipal) -> dict[str, Any]:
    return {
        "type": "group_library",
        "key": build_scope_key("group_library"),
        "label": "课题组文献库",
        "workspaceId": None,
        "ownerUserId": None,
        "isPersonal": False,
        "writable": principal.user.role in GROUP_LIBRARY_WRITE_ROLES,
    }
