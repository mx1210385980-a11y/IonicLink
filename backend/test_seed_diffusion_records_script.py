import sqlite3

from scripts.seed_diffusion_records import promote_diffusion_candidates


def test_promote_diffusion_candidates_copies_candidates_to_records(tmp_path):
    db_path = tmp_path / 'ioniclink.db'
    conn = sqlite3.connect(db_path)
    conn.executescript(
        '''
        create table diffusion_candidates (
            id integer primary key autoincrement,
            literature_id integer not null,
            promoted_record_id integer,
            system_name text,
            confinement_material_class text,
            confinement_geometry_class text,
            surface_functional_groups text,
            confinement_dimensionality text,
            ionic_liquid text,
            d_total real,
            d_cation real,
            d_anion real,
            d_unit text,
            temperature_value real,
            confinement_scale_value real,
            confinement_scale_unit text,
            source text,
            source_page integer,
            source_bbox text,
            evidence text,
            provider text,
            prompt_version text,
            raw_model_output text,
            field_evidence_json text,
            review_status text,
            record_origin text,
            assembly_notes text,
            confidence real not null,
            novel_features_json text,
            smiles text,
            rdkit_features_json text,
            extracted_at text not null,
            promoted_at text
        );
        create table diffusion_records (
            id integer primary key autoincrement,
            literature_id integer not null,
            system_name text,
            confinement_material_class text,
            confinement_geometry_class text,
            surface_functional_groups text,
            confinement_dimensionality text,
            ionic_liquid text,
            d_total real,
            d_cation real,
            d_anion real,
            d_unit text,
            temperature_value real,
            confinement_scale_value real,
            confinement_scale_unit text,
            source text,
            source_page integer,
            source_bbox text,
            evidence text,
            provider text,
            prompt_version text,
            raw_model_output text,
            field_evidence_json text,
            review_status text,
            record_origin text,
            assembly_notes text,
            confidence real not null,
            novel_features_json text,
            smiles text,
            rdkit_features_json text,
            extracted_at text not null
        );
        create table diffusion_feature_sets (
            id integer primary key autoincrement,
            candidate_id integer,
            record_id integer
        );
        insert into diffusion_candidates (
            literature_id, system_name, ionic_liquid, d_total, d_cation, d_anion, d_unit,
            temperature_value, confidence, extracted_at, review_status
        ) values (7, 'Silica nanopore', '[BMIM][BF4]', 1.2, 1.4, 1.0, '10^-12 m2/s', 298.15, 0.91, '2026-05-31', 'ready');
        insert into diffusion_feature_sets(candidate_id) values (1);
        '''
    )
    conn.commit()
    conn.close()

    promoted = promote_diffusion_candidates(db_path, limit=3)

    conn = sqlite3.connect(db_path)
    row = conn.execute('select literature_id, system_name, ionic_liquid, d_total, record_origin from diffusion_records').fetchone()
    candidate = conn.execute('select promoted_record_id, promoted_at from diffusion_candidates where id = 1').fetchone()
    feature = conn.execute('select record_id from diffusion_feature_sets where candidate_id = 1').fetchone()
    conn.close()

    assert promoted == 1
    assert row == (7, 'Silica nanopore', '[BMIM][BF4]', 1.2, 'seed_promoted_candidate')
    assert candidate[0] == 1
    assert candidate[1]
    assert feature == (1,)
