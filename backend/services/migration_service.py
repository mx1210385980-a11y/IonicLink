from __future__ import annotations

from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.schema import CreateColumn, CreateIndex
from sqlalchemy.sql.schema import MetaData

CURRENT_SCHEMA_REVISION = "20260506_0014"


def _inspect_schema(sync_conn, metadata: MetaData) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    table_names = {name for name in inspector.get_table_names() if not name.startswith("sqlite_")}
    expected_tables = set(metadata.tables.keys())
    missing_tables = sorted(expected_tables - table_names)
    missing_columns: dict[str, list[str]] = {}

    for table_name in sorted(expected_tables & table_names):
        existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
        expected_columns = {column.name for column in metadata.tables[table_name].columns}
        missing = sorted(expected_columns - existing_columns)
        if missing:
            missing_columns[table_name] = missing

    revision = None
    if "alembic_version" in table_names:
        row = sync_conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).fetchone()
        revision = str(row[0]) if row else None

    return {
        "table_names": sorted(table_names),
        "missing_tables": missing_tables,
        "missing_columns": missing_columns,
        "revision": revision,
    }


async def inspect_schema(conn: AsyncConnection, metadata: MetaData) -> dict[str, Any]:
    return await conn.run_sync(lambda sync_conn: _inspect_schema(sync_conn, metadata))


async def stamp_schema_revision(conn: AsyncConnection, revision: str = CURRENT_SCHEMA_REVISION) -> None:
    await conn.execute(text("CREATE TABLE IF NOT EXISTS alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
    result = await conn.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
    row = result.fetchone()
    if row:
        await conn.execute(text("UPDATE alembic_version SET version_num = :revision"), {"revision": revision})
    else:
        await conn.execute(text("INSERT INTO alembic_version(version_num) VALUES (:revision)"), {"revision": revision})


def _literal_sql(sync_conn, column, value: Any) -> str:
    compiler = sync_conn.dialect.statement_compiler(sync_conn.dialect, None)
    return compiler.render_literal_value(value, column.type)


def _repair_schema(sync_conn, metadata: MetaData, state: dict[str, Any]) -> None:
    missing_tables = state.get("missing_tables") or []
    missing_columns = state.get("missing_columns") or {}

    if missing_tables:
        metadata.create_all(sync_conn, tables=[metadata.tables[name] for name in missing_tables], checkfirst=True)

    if missing_columns:
        for table_name, column_names in missing_columns.items():
            table = metadata.tables[table_name]
            for column_name in column_names:
                column = table.columns[column_name]
                column_sql = str(CreateColumn(column).compile(dialect=sync_conn.dialect)).strip()
                if "DEFAULT" not in column_sql.upper() and column.default is not None and not callable(column.default.arg):
                    column_sql = f"{column_sql} DEFAULT {_literal_sql(sync_conn, column, column.default.arg)}"
                sync_conn.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN {column_sql}'))

    inspector = inspect(sync_conn)
    existing_indexes = {
        table_name: {index["name"] for index in inspector.get_indexes(table_name)}
        for table_name in metadata.tables.keys()
        if table_name in inspector.get_table_names()
    }
    for table_name, table in metadata.tables.items():
        table_indexes = existing_indexes.get(table_name)
        if table_indexes is None:
            continue
        for index in table.indexes:
            if index.name in table_indexes:
                continue
            sync_conn.execute(CreateIndex(index))


async def repair_schema(conn: AsyncConnection, metadata: MetaData, state: dict[str, Any]) -> None:
    await conn.run_sync(lambda sync_conn: _repair_schema(sync_conn, metadata, state))


def format_schema_error(state: dict[str, Any]) -> str:
    missing_tables = state.get("missing_tables") or []
    missing_columns = state.get("missing_columns") or {}
    parts: list[str] = []
    if missing_tables:
        parts.append(f"missing tables: {', '.join(missing_tables)}")
    if missing_columns:
        column_parts = [f"{table}({', '.join(columns)})" for table, columns in missing_columns.items()]
        parts.append(f"missing columns: {', '.join(column_parts)}")
    details = "; ".join(parts) or "schema drift detected"
    return (
        f"Database schema is out of date: {details}. "
        f"Run `alembic upgrade head` in the backend directory before starting the API."
    )
