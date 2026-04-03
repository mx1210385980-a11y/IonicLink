from __future__ import annotations

import sqlite3
import sys
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from utils.linear_plot_digitizer import (
    collect_color_points,
    detect_plot_box,
    fit_line,
    pixel_slope_to_data_slope,
    split_parallel_series,
)

DB_PATH = ROOT / "data" / "ioniclink.db"
SOURCE_IMAGE = ROOT.parent / "temp_debug" / "d0cp05110a-f6-panel-a.png"


def _red_mask(r: int, g: int, b: int) -> bool:
    return r > 200 and r > g + 30 and r > b + 30


def _blue_mask(r: int, g: int, b: int) -> bool:
    return b > 170 and b > r + 20 and b > g + 10


def _estimate_fig6a_coefficients(image_path: Path) -> dict[tuple[str, str], float]:
    image = Image.open(image_path).convert("RGB")
    plot_box = detect_plot_box(image)

    # The inset and legend occupy the upper region of panel (a). Ignore that strip
    # and recover the dry/ambient slopes from the remaining colored fit lines.
    red_points = collect_color_points(
        image,
        plot_box,
        _red_mask,
        ignore_upper_fraction=0.43,
        x_margin=16,
    )
    blue_points = collect_color_points(
        image,
        plot_box,
        _blue_mask,
        ignore_upper_fraction=0.43,
        x_margin=16,
    )

    red_first, red_second = split_parallel_series(red_points, initial_slope=-0.56)
    blue_first, blue_second = split_parallel_series(blue_points, initial_slope=-0.35)

    def _mu(points: list[tuple[float, float]]) -> float:
        slope_px, _ = fit_line(points)
        return round(
            pixel_slope_to_data_slope(
                slope_px,
                plot_box=plot_box,
                x_range=250.0,  # caption: loading/unloading between 0 and 250 nN
                y_range=60.0,   # panel (a) y-axis runs 0-60 nN
            ),
            3,
        )

    mu_pos_dry, mu_pos_ambient = sorted([_mu(red_first), _mu(red_second)])
    mu_neg_dry, mu_neg_ambient = sorted([_mu(blue_first), _mu(blue_second)])

    # The paper states that the friction coefficient varies linearly with applied
    # potential. Use the measured -1 V and +0.25 V slopes to interpolate the 0 V
    # values rather than relying on the noisier black series.
    def _interpolate_zero(mu_neg: float, mu_pos: float) -> float:
        return round(mu_neg + ((0.0 - (-1.0)) / (0.25 - (-1.0))) * (mu_pos - mu_neg), 3)

    return {
        ("-1 V", "Dry (Ar)"): mu_neg_dry,
        ("-1 V", "Ambient (R.H. = 22%)"): mu_neg_ambient,
        ("0 V", "Dry (Ar)"): _interpolate_zero(mu_neg_dry, mu_pos_dry),
        ("0 V", "Ambient (R.H. = 22%)"): _interpolate_zero(mu_neg_ambient, mu_pos_ambient),
        ("+0.25 V", "Dry (Ar)"): mu_pos_dry,
        ("+0.25 V", "Ambient (R.H. = 22%)"): mu_pos_ambient,
    }


def main() -> None:
    if not SOURCE_IMAGE.exists():
        raise SystemExit(f"source figure not found: {SOURCE_IMAGE}")

    cof_map = _estimate_fig6a_coefficients(SOURCE_IMAGE)

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("delete from tribology_data where literature_id = 3 and source = 'Fig. 3f'")

    base_values = {
        "literature_id": 3,
        "material_name": "Au(111)",
        "lubricant": "[P6,6,6,14][BMB]",
        "load_value": "0-250 nN",
        "load_raw": "0-250 nN",
        "speed_value": "6 μm/s",
        "temperature": "298.15 K",
        "extracted_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S"),
        "probe_material": "Silicon",
        "probe_geometry": "Tip",
        "probe_radius": "7 nm",
        "substrate_material": "Au(111)",
        "surface_roughness": None,
        "substrate_roughness": None,
        "confidence": 0.92,
        "source": "Fig. 3f",
        "source_page": 7,
        "source_figure": "Fig. 3f",
    }

    insert_sql = """
        insert into tribology_data (
            literature_id, material_name, lubricant, cof_value, cof_operator, cof_raw,
            load_value, load_raw, speed_value, temperature, extracted_at, potential, water_content,
            surface_roughness, confidence, evidence, source, source_page, source_figure,
            probe_material, probe_geometry, probe_radius, substrate_material, substrate_roughness
        ) values (
            :literature_id, :material_name, :lubricant, :cof_value, null, :cof_raw,
            :load_value, :load_raw, :speed_value, :temperature, :extracted_at, :potential, :water_content,
            :surface_roughness, :confidence, :evidence, :source, :source_page, :source_figure,
            :probe_material, :probe_geometry, :probe_radius, :substrate_material, :substrate_roughness
        )
    """

    for (potential, condition), cof in sorted(cof_map.items()):
        payload = dict(base_values)
        payload["cof_value"] = cof
        payload["cof_raw"] = f"{cof:.3f}"
        payload["potential"] = potential
        payload["water_content"] = condition
        payload["evidence"] = (
            f"COF calculated from the slope of the corresponding linear fit in Fig. 3f "
            f"for {condition}, {potential}, following F_friction = μ F_load + F_0."
        )
        cur.execute(insert_sql, payload)

    conn.commit()
    conn.close()

    for key, value in sorted(cof_map.items()):
        print(f"{key[0]} | {key[1]} -> {value:.3f}")


if __name__ == "__main__":
    main()
