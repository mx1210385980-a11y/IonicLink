#!/usr/bin/env python3
from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = REPO_ROOT / "backend" / "data" / "ioniclink.db"
GROUP_ID = 1
USER_ID = 1
SCOPE_KEY = "group_library"


LITERATURE = [
    {
        "doi": "10.1380/ejssnt.2023-056",
        "title": "Effects of Relative Humidity on Lubricating Properties of Ionic Liquids",
        "authors": "Ryo Sato; Shinya Sasaki; Hiroshi Washizu",
        "journal": "e-Journal of Surface Science and Nanotechnology",
        "year": 2023,
        "volume": "21",
        "issue": None,
        "pages": "365-372",
        "content": (
            "Codex-reviewed source notes: this paper compares ionic liquid lubricating "
            "properties at relative humidity levels of 15%, 50%, and 80%. "
            "DOI: 10.1380/ejssnt.2023-056."
        ),
    },
    {
        "doi": "10.1039/C5CP05837F",
        "title": "Is the boundary layer of an ionic liquid equally lubricating at higher temperature?",
        "authors": "Nicklas Hjalmarsson; Mark W. Rutland; Rob Atkin",
        "journal": "Physical Chemistry Chemical Physics",
        "year": 2016,
        "volume": "18",
        "issue": "2",
        "pages": "923-930",
        "content": (
            "Codex-reviewed source notes: AFM was used to study EAN confined between "
            "mica and a silica colloid probe at 25 °C, 50 °C, and 80 °C. "
            "DOI: 10.1039/C5CP05837F."
        ),
    },
    {
        "doi": "10.1038/s41598-021-02763-5",
        "title": "The effect of anion architecture on the lubrication chemistry of phosphonium orthoborate ionic liquids",
        "authors": "Geoffrey J. P. K. Anggara; Robert D. Evans; Nicholas D. Spencer; Stephen M. Hsu",
        "journal": "Scientific Reports",
        "year": 2021,
        "volume": "11",
        "issue": None,
        "pages": "23480",
        "content": (
            "Codex-reviewed source notes: Methods report 100 °C reciprocating tribotests "
            "with 1 mm stroke length, 50 Hz frequency, 20 N running-in load and 40 N "
            "test load; source reports PBScB/PBMB friction coefficient around 0.08. "
            "DOI: 10.1038/s41598-021-02763-5."
        ),
    },
    {
        "doi": "10.3390/lubricants7030027",
        "title": "Influence of Water on Tribolayer Growth When Lubricating Steel with a Fluorinated Phosphonium Dicyanamide Ionic Liquid",
        "authors": "Yuanyuan Zhou; Craig J. Reeves; Nicholas D. Spencer; Stephen M. Hsu",
        "journal": "Lubricants",
        "year": 2019,
        "volume": "7",
        "issue": "3",
        "pages": "27",
        "content": (
            "Codex-reviewed source notes: tribotest conditions include 5 N load, "
            "1.25 mm/s sliding speed, 20 min duration, T = 21 ± 1 °C, and "
            "35% ± 5% RH; humid air F6 average CoF reported as 0.95 ± 0.02. "
            "DOI: 10.3390/lubricants7030027."
        ),
    },
    {
        "doi": "10.1039/D0CP05110A",
        "title": "Effect of water on the electroresponsive structuring and friction in dilute and concentrated ionic liquid lubricant mixtures",
        "authors": "Georgia A. Pilkington; Rebecca Welbourn; Anna Oleshkevych; Seiya Watanabe; Patricia Pedraz; Milad Radiom; Sergei Glavatskih; Mark W. Rutland",
        "journal": "Physical Chemistry Chemical Physics",
        "year": 2020,
        "volume": "22",
        "issue": None,
        "pages": "28191-28201",
        "content": (
            "Codex-reviewed source notes: AFM friction measurements used dry and "
            "ambient solutions; ambient condition was R.H. = 22%, and the open "
            "circuit potential (OCP) of the dry and ambient solutions was -160 mV. "
            "DOI: 10.1039/D0CP05110A."
        ),
    },
    {
        "doi": "10.3390/ma18010018",
        "title": "Tribological Properties of Selected Ionic Liquids in Lubricated Friction Nodes",
        "authors": "Monika Madej; Joanna Kowalczyk; Marcin Kowalski; Paweł Grabowski; Jacek Wernik",
        "journal": "Materials",
        "year": 2025,
        "volume": "18",
        "issue": "1",
        "pages": "18",
        "content": (
            "Codex-reviewed source notes: ball-on-disc tribological tests used "
            "100Cr6 steel ball/disc contact, 10 N load, 0.1 m/s sliding velocity, "
            "1000 m sliding distance, ambient (25 ± 1.5 °C) and 40 °C temperatures, "
            "and 40 ± 0.5% humidity. DOI: 10.3390/ma18010018."
        ),
    },
    {
        "doi": "10.1007/s11249-024-01898-6",
        "title": "Ionic Liquids as Extreme Pressure Additives for Bearing Steel Applications",
        "authors": "Mariana T. Donato; Pranjal Nautiyal; Jonas Deuermeier; Luís C. Branco; Benilde Saramago; Rogério Colaço; Robert W. Carpick",
        "journal": "Tribology Letters",
        "year": 2024,
        "volume": "72",
        "issue": "3",
        "pages": "101",
        "content": (
            "Codex-reviewed source notes: mini traction machine tests used ASTM "
            "52100 steel ball/disk contacts, 2 wt% ionic liquid additives in PEG 200, "
            "about 2 wt% water content, 60 °C, 50 N applied load, SRR 50%, and "
            "10 mm·s−1 entrainment speed for MTM measurements. "
            "DOI: 10.1007/s11249-024-01898-6."
        ),
    },
    {
        "doi": "10.3389/fmech.2021.756929",
        "title": "Ionic Liquid Additives in Water-Based Lubricants for Bearing Steel - Effect of Electrical Conductivity and pH on Surface Chemistry, Friction and Wear",
        "authors": "W. Wijanarko; H. Khanmohammadi; N. Espallargas",
        "journal": "Frontiers in Mechanical Engineering",
        "year": 2022,
        "volume": "7",
        "issue": None,
        "pages": "756929",
        "content": (
            "Codex-reviewed source notes: rotating ball-on-disk tribology used an "
            "alumina ball against AISI 52100 steel disk in water-glycol lubricant, "
            "1 wt% ionic liquid additive concentration, normal load 20 N, 40 rpm "
            "disk rotation, 10 mm track diameter, 2.09 cm/s sliding speed, and "
            "room temperature. DOI: 10.3389/fmech.2021.756929."
        ),
    },
]


RECORDS_BY_DOI = {
    "10.1380/ejssnt.2023-056": [
        {
            "material_name": "ionic liquid humidity tribotest",
            "lubricant": "[BMIM][FAP]",
            "water_content": "15% RH; 50% RH; 80% RH",
            "regime": "Relative humidity series for IL lubrication comparison",
            "tribological_system_json": {
                "scale": "macroscale",
                "profile": "macro",
                "method": "tribotest",
                "measurement_type": "humidity_response",
            },
            "evidence": "Lubricating properties were investigated at different relative humidity (RH) levels (15, 50, and 80%).",
            "source": "Abstract",
        }
    ],
    "10.1039/C5CP05837F": [
        {
            "material_name": "silica colloid probe / mica surface",
            "lubricant": "ethylammonium nitrate (EAN)",
            "temperature": "298.15 K; 323.15 K; 353.15 K",
            "regime": "AFM boundary layer friction temperature series",
            "tribological_system_json": {
                "scale": "nanoscale",
                "profile": "afm",
                "method": "afm_colloidal_probe",
                "contact_geometry": "afm_colloidal_probe",
            },
            "evidence": (
                "Atomic force microscopy was used to study friction for EAN confined "
                "between mica and a silica colloid probe at 25 °C, 50 °C, and 80 °C."
            ),
            "source": "Abstract",
        }
    ],
    "10.1038/s41598-021-02763-5": [
        {
            "material_name": "bearing steel ball / bearing steel plate",
            "lubricant": "trihexyl(tetradecyl)phosphonium bis(salicylato)borate (PBScB)",
            "cof_value": 0.08,
            "cof_raw": "~0.08",
            "load_value": "40 N",
            "load_raw": "40 N",
            "speed_value": "100000 μm/s",
            "speed_conditions_json": {
                "raw_text": "stroke length 1 mm; frequency 50 Hz",
                "value_type": "derived",
                "sliding_velocity_um_s": 100000,
                "scan_rate_hz": 50,
                "scan_length_um": 1000,
            },
            "temperature": "373.15 K",
            "regime": "Reciprocating tribotest; 20 N running-in before 40 N test load",
            "tribological_system_json": {
                "scale": "macroscale",
                "profile": "macro",
                "method": "reciprocating_tribometer",
                "contact_geometry": "ball_on_plate",
            },
            "evidence": (
                "Tests were performed at 100 °C with a stroke length of 1 mm and "
                "frequency of 50 Hz; tribotests used 20 N running-in followed by "
                "the 40 N test load; PBScB showed CoF ca. 0.08."
            ),
            "source": "Methods; Figure 2",
        }
    ],
    "10.3390/lubricants7030027": [
        {
            "material_name": "100Cr6 ball / 100Cr6 disk",
            "lubricant": "tributyl-tridecafluorooctyl-phosphonium dicyanamide (F6)",
            "cof_value": 0.95,
            "cof_raw": "0.95 ± 0.02",
            "load_value": "5 N",
            "load_raw": "5 N",
            "speed_value": "1.25 mm/s",
            "temperature": "294.15 K",
            "water_content": "35 ± 5% RH",
            "regime": "Humid-air tribotest; 20 min duration",
            "tribological_system_json": {
                "scale": "macroscale",
                "profile": "macro",
                "method": "pin_on_disk",
                "contact_geometry": "ball_on_disk",
            },
            "evidence": (
                "Tribotest conditions: load 5 N, sliding speed 1.25 mm/s, time 20 min, "
                "T = 21 ± 1 °C, 35% ± 5% RH; average CoF of 0.95 ± 0.02 for F6 in humid air."
            ),
            "source": "Figure 2; Figure 6 caption",
        }
    ],
    "10.1039/D0CP05110A": [
        {
            "material_name": "sharp Si AFM tip / Au electrode",
            "lubricant": "[P6,6,6,14][BMB] in propylene carbonate",
            "speed_value": "1, 6 and 12 μm/s",
            "potential": "-0.16 V vs OCP",
            "water_content": "dry; ambient R.H. = 22%",
            "regime": "Electrochemical AFM friction for dry and ambient lubricant mixtures",
            "tribological_system_json": {
                "scale": "nanoscale",
                "profile": "afm",
                "method": "electrochemical_afm",
                "contact_geometry": "afm_tip_on_electrode",
            },
            "evidence": (
                "The open circuit potential (OCP) of the dry and ambient solutions "
                "was -160 mV; AFM friction was measured in dry and ambient conditions "
                "(R.H. = 22%) at 1, 6 and 12 μm s−1."
            ),
            "source": "Methods; Section 3.2",
        }
    ],
    "10.3390/ma18010018": [
        {
            "material_name": "100Cr6 steel ball / 100Cr6 steel disc",
            "lubricant": "1-Butyl-3-methylimidazolium hexafluorophosphate (BMIMPF6)",
            "load_value": "10 N",
            "load_raw": "Load (P) = 10 N",
            "speed_value": "0.1 m/s",
            "temperature": "298.15 K; 313.15 K",
            "water_content": "40 ± 0.5% humidity",
            "regime": "TRB3 ball-on-disc tribotest; 1000 m sliding distance",
            "tribological_system_json": {
                "scale": "macroscale",
                "profile": "macro",
                "method": "ball_on_disc",
                "contact_geometry": "ball_on_disc",
            },
            "evidence": (
                "Methods list TRB3 ball-on-disc tests with 10 N load, 0.1 m/s "
                "sliding velocity, 1000 m sliding distance, 100Cr6 steel ball/disc "
                "contact, ambient (25 ± 1.5 °C) and 40 °C temperatures, and "
                "40 ± 0.5% humidity."
            ),
            "source": "Materials and Methods",
        }
    ],
    "10.1007/s11249-024-01898-6": [
        {
            "material_name": "ASTM 52100 steel ball / ASTM 52100 steel disk",
            "lubricant": "[C6mim][TfO] as 2 wt% additive in PEG 200 + 1% RC4801",
            "load_value": "50 N",
            "load_raw": "applied load of 50 N",
            "speed_value": "10 mm/s",
            "temperature": "333.15 K",
            "water_content": "about 2 wt%",
            "regime": "Mini traction machine; SRR 50%; Hertzian maximum contact pressure 1.12 GPa",
            "tribological_system_json": {
                "scale": "macroscale",
                "profile": "macro",
                "method": "mini_traction_machine",
                "contact_geometry": "ball_on_disk",
            },
            "evidence": (
                "MTM tests used 52100 steel balls and disks; Stribeck measurements "
                "were performed at 60 °C, SRR 50%, and 50 N load; all other MTM "
                "measurements used 10 mm·s−1 entrainment speed; water content of "
                "the 2 wt% IL solutions in PEG was around 2 wt%."
            ),
            "source": "Experimental Section",
        }
    ],
    "10.3389/fmech.2021.756929": [
        {
            "material_name": "alumina ball / AISI 52100 steel disk",
            "lubricant": "1 wt% tributylmethylphosphonium dimethylphosphate (PP) in water-glycol",
            "cof_value": 0.19,
            "cof_raw": "0.19",
            "load_value": "20 N",
            "load_raw": "normal load applied was 20 N",
            "speed_value": "2.09 cm/s",
            "temperature": "298.15 K",
            "regime": "Rotating ball-on-disk tribometer; 40 rpm; 10 mm track diameter; boundary lubrication",
            "tribological_system_json": {
                "scale": "macroscale",
                "profile": "macro",
                "method": "rotating_ball_on_disk",
                "contact_geometry": "ball_on_disk",
            },
            "evidence": (
                "Friction and wear were measured using a rotating ball-on-disk "
                "tribometer with an alumina ball on AISI 52100 steel disk; normal "
                "load applied was 20 N; disk rotation speed and track diameter were "
                "40 rpm and 10 mm, giving 2.09 cm/s sliding speed; WG-PP increased "
                "to a COF of 0.19 at the end of the test."
            ),
            "source": "Testing and Characterization Methods; Figure 1 discussion",
        }
    ],
}


def build_field_evidence_map(row: dict) -> dict:
    evidence = {
        "source_type": "curated_review",
        "source_label": row["source"],
        "quote": row["evidence"],
        "matched_text": row["evidence"],
    }

    def entry(value, confidence: float = 0.95) -> dict:
        return {
            "value": value,
            "confidence": confidence,
            "evidence": dict(evidence),
            "grounding_mode": "curated_source_note",
            "grounding_note": "Codex-reviewed source note; exact PDF coordinates are not available for this manually curated seed row.",
        }

    field_map = {
        "material": entry(row["material_name"]),
        "ionic_liquid": entry(row["lubricant"]),
    }
    optional_fields = {
        "cof": row.get("cof_raw") or (str(row.get("cof_value")) if row.get("cof_value") is not None else None),
        "load": row.get("load_raw") or row.get("load_value"),
        "speed": row.get("speed_value"),
        "temperature": row.get("temperature"),
        "potential": row.get("potential"),
        "water_content": row.get("water_content"),
        "regime": row.get("regime"),
        "tribological_system": row.get("tribological_system_json"),
    }
    for key, value in optional_fields.items():
        if value:
            field_map[key] = entry(value)
    return field_map


def backup_database() -> Path:
    backup_dir = DB_PATH.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"ioniclink.before-codex-reviewed-library-{time.strftime('%Y%m%d-%H%M%S')}.db"
    src = sqlite3.connect(DB_PATH)
    try:
        dst = sqlite3.connect(backup_path)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    return backup_path


def main() -> None:
    backup_path = backup_database()
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(sep=" ", timespec="seconds")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("BEGIN")
        doi_to_id: dict[str, int] = {}
        for item in LITERATURE:
            existing = conn.execute(
                "select id, content from literature where group_id=? and scope_key=? and lower(doi)=lower(?)",
                (GROUP_ID, SCOPE_KEY, item["doi"]),
            ).fetchone()
            if existing:
                lit_id = int(existing["id"])
                conn.execute(
                    """
                    update literature
                    set doi=?, title=?, authors=?, journal=?, year=?, volume=?, issue=?, pages=?,
                        content=?, group_id=?, created_by_user_id=coalesce(created_by_user_id, ?),
                        scope_type='group_library', scope_key=?, status='completed',
                        submission_status='approved', submitted_at=coalesce(submitted_at, ?),
                        submitted_by_user_id=coalesce(submitted_by_user_id, ?), reviewed_at=?,
                        reviewed_by_user_id=?, review_note='Codex-reviewed literature fixture admitted to Library.'
                    where id=?
                    """,
                    (
                        item["doi"],
                        item["title"],
                        item["authors"],
                        item["journal"],
                        item["year"],
                        item["volume"],
                        item["issue"],
                        item["pages"],
                        existing["content"] or item["content"],
                        GROUP_ID,
                        USER_ID,
                        SCOPE_KEY,
                        now,
                        USER_ID,
                        now,
                        USER_ID,
                        lit_id,
                    ),
                )
            else:
                cursor = conn.execute(
                    """
                    insert into literature (
                        doi, title, authors, journal, year, volume, issue, pages, content,
                        group_id, created_by_user_id, scope_type, scope_key, status, created_at,
                        submission_status, submitted_at, submitted_by_user_id, reviewed_at,
                        reviewed_by_user_id, review_note
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'group_library', ?, 'completed', ?, 'approved', ?, ?, ?, ?, ?)
                    """,
                    (
                        item["doi"],
                        item["title"],
                        item["authors"],
                        item["journal"],
                        item["year"],
                        item["volume"],
                        item["issue"],
                        item["pages"],
                        item["content"],
                        GROUP_ID,
                        USER_ID,
                        SCOPE_KEY,
                        now,
                        now,
                        USER_ID,
                        now,
                        USER_ID,
                        "Codex-reviewed literature fixture admitted to Library.",
                    ),
                )
                lit_id = int(cursor.lastrowid)
            doi_to_id[item["doi"].lower()] = lit_id

        lit_ids = list(doi_to_id.values())
        conn.execute(
            "delete from tribology_data where record_origin='codex_reviewed_condition' "
            f"and literature_id in ({','.join('?' for _ in lit_ids)})",
            lit_ids,
        )

        inserted_records = 0
        for doi, rows in RECORDS_BY_DOI.items():
            lit_id = doi_to_id[doi.lower()]
            for row in rows:
                conn.execute(
                    """
                    insert into tribology_data (
                        literature_id, material_name, lubricant, cof_value, cof_raw,
                        load_value, load_raw, speed_value, speed_conditions_json,
                        temperature, potential, water_content, regime, tribological_system_json,
                        extracted_at, confidence, review_status, record_origin, assembly_notes,
                        evidence, source, field_evidence_json
                    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved',
                        'codex_reviewed_condition', ?, ?, ?, ?)
                    """,
                    (
                        lit_id,
                        row["material_name"],
                        row["lubricant"],
                        row.get("cof_value"),
                        row.get("cof_raw"),
                        row.get("load_value"),
                        row.get("load_raw"),
                        row.get("speed_value"),
                        json.dumps(row.get("speed_conditions_json"), ensure_ascii=False)
                        if row.get("speed_conditions_json")
                        else None,
                        row.get("temperature"),
                        row.get("potential"),
                        row.get("water_content"),
                        row.get("regime"),
                        json.dumps(row.get("tribological_system_json"), ensure_ascii=False)
                        if row.get("tribological_system_json")
                        else None,
                        now,
                        0.95,
                        "Codex-reviewed source-backed condition/finding record; inserted as final Library data, not a candidate.",
                        row["evidence"],
                        row["source"],
                        json.dumps(build_field_evidence_map(row), ensure_ascii=False, separators=(",", ":")),
                    ),
                )
                inserted_records += 1

        pccp_id = doi_to_id["10.1039/c5cp05837f"]
        conn.execute(
            """
            update tribology_data
            set review_status='approved',
                record_origin=case
                    when record_origin is null or record_origin='' or record_origin='cached_record'
                    then 'codex_reviewed_existing'
                    else record_origin
                end,
                assembly_notes=coalesce(assembly_notes, 'Codex reviewed existing Library record.')
            where literature_id=? and coalesce(review_status,'') not in ('approved','accepted')
            """,
            (pccp_id,),
        )
        conn.commit()
    finally:
        conn.close()

    print(f"backup={backup_path}")
    print(f"upserted_literature={len(LITERATURE)}")
    print(f"inserted_reviewed_records={inserted_records}")


if __name__ == "__main__":
    main()
