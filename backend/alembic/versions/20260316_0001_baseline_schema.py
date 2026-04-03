"""baseline schema

Revision ID: 20260316_0001
Revises:
Create Date: 2026-03-16 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260316_0001"
down_revision = None
branch_labels = None
depends_on = None


def _table_names(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _column_names(bind, table_name: str) -> set[str]:
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def _index_map(bind, table_name: str) -> dict[str, dict]:
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return {}
    return {index["name"]: index for index in inspector.get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = _table_names(bind)

    if "research_groups" not in tables:
        op.create_table(
            "research_groups",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=120), nullable=False, unique=True),
            sa.Column("slug", sa.String(length=120), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_research_groups_slug", "research_groups", ["slug"], unique=True)

    tables = _table_names(bind)
    if "users" not in tables:
        op.create_table(
            "users",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("username", sa.String(length=80), nullable=False),
            sa.Column("display_name", sa.String(length=120), nullable=False),
            sa.Column("password_hash", sa.String(length=255), nullable=False),
            sa.Column("role", sa.String(length=40), nullable=False, server_default="researcher"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("group_id", sa.Integer(), sa.ForeignKey("research_groups.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_users_username", "users", ["username"], unique=True)
        op.create_index("ix_users_role", "users", ["role"])
        op.create_index("ix_users_group_id", "users", ["group_id"])

    tables = _table_names(bind)
    if "workspaces" not in tables:
        op.create_table(
            "workspaces",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("group_id", sa.Integer(), sa.ForeignKey("research_groups.id"), nullable=False),
            sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("slug", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_personal", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("group_id", "slug", name="uq_workspaces_group_slug"),
        )
        op.create_index("ix_workspaces_group_id", "workspaces", ["group_id"])
        op.create_index("ix_workspaces_owner_user_id", "workspaces", ["owner_user_id"])

    tables = _table_names(bind)
    if "literature" not in tables:
        op.create_table(
            "literature",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("doi", sa.String(length=100), nullable=False),
            sa.Column("title", sa.String(length=500), nullable=False),
            sa.Column("authors", sa.Text(), nullable=False),
            sa.Column("journal", sa.String(length=200), nullable=False),
            sa.Column("issn", sa.String(length=20), nullable=True),
            sa.Column("year", sa.Integer(), nullable=False),
            sa.Column("volume", sa.String(length=20), nullable=True),
            sa.Column("issue", sa.String(length=20), nullable=True),
            sa.Column("pages", sa.String(length=50), nullable=True),
            sa.Column("content", sa.Text(), nullable=True),
            sa.Column("file_path", sa.String(length=500), nullable=True),
            sa.Column("group_id", sa.Integer(), sa.ForeignKey("research_groups.id"), nullable=True),
            sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("workspaces.id"), nullable=True),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("scope_type", sa.String(length=32), nullable=False, server_default="group_library"),
            sa.Column("scope_key", sa.String(length=64), nullable=False, server_default="group_library"),
            sa.Column("status", sa.String(length=50), nullable=False, server_default="pending"),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("group_id", "scope_key", "doi", name="uq_literature_scope_doi"),
        )
        op.create_index("ix_literature_doi", "literature", ["doi"])
        op.create_index("ix_literature_status", "literature", ["status"])
        op.create_index("ix_literature_group_id", "literature", ["group_id"])
        op.create_index("ix_literature_workspace_id", "literature", ["workspace_id"])
        op.create_index("ix_literature_scope_type", "literature", ["scope_type"])
        op.create_index("ix_literature_created_by_user_id", "literature", ["created_by_user_id"])
    else:
        literature_columns = _column_names(bind, "literature")
        for name, column in [
            ("group_id", sa.Column("group_id", sa.Integer(), nullable=True)),
            ("workspace_id", sa.Column("workspace_id", sa.Integer(), nullable=True)),
            ("created_by_user_id", sa.Column("created_by_user_id", sa.Integer(), nullable=True)),
            ("scope_type", sa.Column("scope_type", sa.String(length=32), nullable=False, server_default="group_library")),
            ("scope_key", sa.Column("scope_key", sa.String(length=64), nullable=False, server_default="group_library")),
            ("status", sa.Column("status", sa.String(length=50), nullable=False, server_default="pending")),
            ("error_message", sa.Column("error_message", sa.Text(), nullable=True)),
        ]:
            if name not in literature_columns:
                op.add_column("literature", column)

        op.execute(
            """
            UPDATE literature
            SET scope_type = COALESCE(scope_type, 'group_library'),
                scope_key = CASE WHEN scope_key IS NULL OR scope_key = '' THEN 'group_library' ELSE scope_key END
            """
        )
        indexes = _index_map(bind, "literature")
        legacy_doi = indexes.get("ix_literature_doi")
        if legacy_doi and legacy_doi.get("unique"):
            op.drop_index("ix_literature_doi", table_name="literature")
            indexes.pop("ix_literature_doi", None)
        if "ix_literature_doi" not in indexes:
            op.create_index("ix_literature_doi", "literature", ["doi"])
        if "ix_literature_status" not in indexes:
            op.create_index("ix_literature_status", "literature", ["status"])
        if "ix_literature_group_id" not in indexes:
            op.create_index("ix_literature_group_id", "literature", ["group_id"])
        if "ix_literature_workspace_id" not in indexes:
            op.create_index("ix_literature_workspace_id", "literature", ["workspace_id"])
        if "ix_literature_scope_type" not in indexes:
            op.create_index("ix_literature_scope_type", "literature", ["scope_type"])
        if "ix_literature_created_by_user_id" not in indexes:
            op.create_index("ix_literature_created_by_user_id", "literature", ["created_by_user_id"])
        if "uq_literature_scope_doi" not in indexes:
            op.create_index("uq_literature_scope_doi", "literature", ["group_id", "scope_key", "doi"], unique=True)

    tables = _table_names(bind)
    if "tribology_data" not in tables:
        op.create_table(
            "tribology_data",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("literature_id", sa.Integer(), sa.ForeignKey("literature.id"), nullable=False),
            sa.Column("material_name", sa.String(length=255), nullable=False),
            sa.Column("lubricant", sa.String(length=255), nullable=False),
            sa.Column("cof_value", sa.Float(), nullable=True),
            sa.Column("cof_operator", sa.String(length=10), nullable=True),
            sa.Column("cof_raw", sa.String(length=100), nullable=True),
            sa.Column("load_value", sa.String(length=100), nullable=True),
            sa.Column("load_raw", sa.String(length=100), nullable=True),
            sa.Column("speed_value", sa.String(length=100), nullable=True),
            sa.Column("temperature", sa.String(length=100), nullable=True),
            sa.Column("potential", sa.String(length=50), nullable=True),
            sa.Column("water_content", sa.String(length=50), nullable=True),
            sa.Column("probe_material", sa.String(length=255), nullable=True),
            sa.Column("probe_geometry", sa.String(length=100), nullable=True),
            sa.Column("probe_radius", sa.String(length=100), nullable=True),
            sa.Column("probe_roughness", sa.String(length=100), nullable=True),
            sa.Column("substrate_material", sa.String(length=255), nullable=True),
            sa.Column("substrate_coating", sa.String(length=255), nullable=True),
            sa.Column("substrate_roughness", sa.String(length=100), nullable=True),
            sa.Column("surface_roughness", sa.String(length=100), nullable=True),
            sa.Column("residual_film_thickness_d", sa.String(length=100), nullable=True),
            sa.Column("layer_spacing_delta", sa.String(length=100), nullable=True),
            sa.Column("film_thickness", sa.String(length=100), nullable=True),
            sa.Column("mol_ratio", sa.String(length=50), nullable=True),
            sa.Column("cation", sa.String(length=100), nullable=True),
            sa.Column("anion", sa.String(length=100), nullable=True),
            sa.Column("cation_smiles", sa.String(length=500), nullable=True),
            sa.Column("anion_smiles", sa.String(length=500), nullable=True),
            sa.Column("il_smiles", sa.String(length=500), nullable=True),
            sa.Column("il_inchikey", sa.String(length=27), nullable=True),
            sa.Column("alkyl_chain_length", sa.Integer(), nullable=True),
            sa.Column("extracted_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("confidence", sa.Float(), nullable=False, server_default="0.9"),
            sa.Column("evidence", sa.Text(), nullable=True),
            sa.Column("evidence_page", sa.Integer(), nullable=True),
            sa.Column("evidence_bbox", sa.String(length=200), nullable=True),
            sa.Column("source", sa.String(length=200), nullable=True),
            sa.Column("source_page", sa.Integer(), nullable=True),
            sa.Column("source_figure", sa.String(length=120), nullable=True),
        )
        op.create_index("ix_tribology_data_il_inchikey", "tribology_data", ["il_inchikey"])
    else:
        tribology_columns = _column_names(bind, "tribology_data")
        for name, column in [
            ("evidence_page", sa.Column("evidence_page", sa.Integer(), nullable=True)),
            ("evidence_bbox", sa.Column("evidence_bbox", sa.String(length=200), nullable=True)),
            ("source", sa.Column("source", sa.String(length=200), nullable=True)),
            ("source_page", sa.Column("source_page", sa.Integer(), nullable=True)),
            ("source_figure", sa.Column("source_figure", sa.String(length=120), nullable=True)),
            ("probe_material", sa.Column("probe_material", sa.String(length=255), nullable=True)),
            ("probe_geometry", sa.Column("probe_geometry", sa.String(length=100), nullable=True)),
            ("probe_radius", sa.Column("probe_radius", sa.String(length=100), nullable=True)),
            ("probe_roughness", sa.Column("probe_roughness", sa.String(length=100), nullable=True)),
            ("substrate_material", sa.Column("substrate_material", sa.String(length=255), nullable=True)),
            ("substrate_coating", sa.Column("substrate_coating", sa.String(length=255), nullable=True)),
            ("substrate_roughness", sa.Column("substrate_roughness", sa.String(length=100), nullable=True)),
        ]:
            if name not in tribology_columns:
                op.add_column("tribology_data", column)

        if "il_inchikey" in _column_names(bind, "tribology_data"):
            indexes = _index_map(bind, "tribology_data")
            if "ix_tribology_data_il_inchikey" not in indexes:
                op.create_index("ix_tribology_data_il_inchikey", "tribology_data", ["il_inchikey"])

        op.execute(
            """
            UPDATE tribology_data
            SET substrate_material = COALESCE(NULLIF(substrate_material, ''), material_name)
            WHERE material_name IS NOT NULL AND TRIM(material_name) != ''
            """
        )
        op.execute(
            """
            UPDATE tribology_data
            SET substrate_roughness = COALESCE(NULLIF(substrate_roughness, ''), surface_roughness)
            WHERE surface_roughness IS NOT NULL AND TRIM(surface_roughness) != ''
            """
        )

    tables = _table_names(bind)
    if "extraction_runs" not in tables:
        op.create_table(
            "extraction_runs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("run_id", sa.String(length=64), nullable=False),
            sa.Column("literature_id", sa.Integer(), sa.ForeignKey("literature.id"), nullable=False),
            sa.Column("profile", sa.String(length=32), nullable=False, server_default="high_accuracy"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="running"),
            sa.Column("candidate_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("final_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("dropped_by_reason", sa.Text(), nullable=True),
            sa.Column("page_coverage", sa.Text(), nullable=True),
            sa.Column("summary_json", sa.Text(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_extraction_runs_run_id", "extraction_runs", ["run_id"], unique=True)
        op.create_index("ix_extraction_runs_literature_id", "extraction_runs", ["literature_id"])
        op.create_index("ix_extraction_runs_status", "extraction_runs", ["status"])

    tables = _table_names(bind)
    if "extraction_candidates" not in tables:
        op.create_table(
            "extraction_candidates",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("run_id", sa.String(length=64), sa.ForeignKey("extraction_runs.run_id"), nullable=False),
            sa.Column("stage", sa.String(length=32), nullable=False),
            sa.Column("modality", sa.String(length=32), nullable=False),
            sa.Column("page", sa.Integer(), nullable=True),
            sa.Column("source_figure", sa.String(length=120), nullable=True),
            sa.Column("panel_label", sa.String(length=120), nullable=True),
            sa.Column("raw_json", sa.Text(), nullable=True),
            sa.Column("normalized_json", sa.Text(), nullable=True),
            sa.Column("drop_reason", sa.String(length=120), nullable=True),
            sa.Column("merged_into", sa.String(length=120), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_extraction_candidates_run_id", "extraction_candidates", ["run_id"])

    tables = _table_names(bind)
    if "cleaned_datasets" not in tables:
        op.create_table(
            "cleaned_datasets",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("target_key", sa.String(length=40), nullable=False, server_default="cof"),
            sa.Column("source_scope_type", sa.String(length=32), nullable=False, server_default="group_library"),
            sa.Column("source_scope_key", sa.String(length=64), nullable=False, server_default="group_library"),
            sa.Column("group_id", sa.Integer(), sa.ForeignKey("research_groups.id"), nullable=False),
            sa.Column("workspace_id", sa.Integer(), sa.ForeignKey("workspaces.id"), nullable=True),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("scope_type", sa.String(length=32), nullable=False, server_default="workspace"),
            sa.Column("scope_key", sa.String(length=64), nullable=False),
            sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("config_json", sa.Text(), nullable=False),
            sa.Column("summary_json", sa.Text(), nullable=False),
            sa.Column("rows_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        )
        op.create_index("ix_cleaned_datasets_group_id", "cleaned_datasets", ["group_id"])
        op.create_index("ix_cleaned_datasets_workspace_id", "cleaned_datasets", ["workspace_id"])
        op.create_index("ix_cleaned_datasets_created_by_user_id", "cleaned_datasets", ["created_by_user_id"])


def downgrade() -> None:
    raise NotImplementedError("Downgrade is not supported for the baseline schema migration.")
