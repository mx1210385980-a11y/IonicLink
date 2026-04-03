from __future__ import annotations

import math
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import LinearSegmentedColormap


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "databackup"
OUTPUT_DIR = ROOT / "frontend" / "public" / "generated"

DATASET_CONFIGS = [
    {
        "label": "Dataset-A (No Film Thickness)",
        "output": OUTPUT_DIR / "dataset-a-correlation-heatmap.png",
        "path": DATA_DIR / "no film dataset 0312.csv",
        "columns": [
            "r_cat",
            "logP_cat",
            "MW_cat",
            "N_rot_cat",
            "Bertz_cat",
            "N_qN_cat",
            "TPSA_cat",
            "BalJ_cat",
            "N_HA_cat",
            "N_HD_cat",
            "logP_an",
            "MW_an",
            "Bertz_an",
            "TPSA_an",
            "BalJ_an",
            "γ_s",
            "σ_s",
            "θ_s",
            "Rq",
            "I_ss",
            "velocity",
            "Potential",
            "I_H2O",
            "x_IL",
            "μ",
        ],
    },
    {
        "label": "Dataset-B (With Film Thickness)",
        "output": OUTPUT_DIR / "dataset-b-correlation-heatmap.png",
        "path": DATA_DIR / "film dataset0312.csv",
        "columns": [
            "r_cat",
            "logP_cat",
            "MW_cat",
            "N_rot_cat",
            "Bertz_cat",
            "N_qN_cat",
            "TPSA_cat",
            "BalJ_cat",
            "N_HA_cat",
            "logP_an",
            "MW_an",
            "Bertz_an",
            "TPSA_an",
            "BalJ_an",
            "γ_s",
            "σ_s",
            "θ_s",
            "Rq",
            "I_ss",
            "velocity",
            "Potential",
            "I_H2O",
            "x_IL",
            "h",
            "μ",
        ],
    },
]


def load_frame(path: Path, columns: list[str]) -> pd.DataFrame:
    frame = pd.read_csv(path, encoding="utf-8-sig")
    available = [column for column in columns if column in frame.columns]
    numeric = frame[available].apply(pd.to_numeric, errors="coerce")
    return numeric


def draw_heatmap(output_path: Path, frame: pd.DataFrame, title: str, cmap) -> None:
    corr = frame.corr(method="pearson")
    matrix = corr.to_numpy()

    fig, ax = plt.subplots(figsize=(12.5, 11.6), dpi=220)
    image = ax.imshow(matrix, cmap=cmap, vmin=-1, vmax=1, aspect="auto")

    ax.set_xticks(np.arange(len(corr.columns)))
    ax.set_yticks(np.arange(len(corr.index)))
    ax.set_xticklabels(corr.columns, rotation=55, ha="right", fontsize=10, fontweight="bold")
    ax.set_yticklabels(corr.index, fontsize=10, fontweight="bold")
    ax.set_title(title, fontsize=20, fontweight="bold", pad=20)

    for row in range(matrix.shape[0]):
        for col in range(matrix.shape[1]):
            value = matrix[row, col]
            if math.isnan(value):
                text = ""
            else:
                text = f"{value:.2f}".rstrip("0").rstrip(".")
            color = "white" if abs(value) > 0.63 else "#111827"
            ax.text(col, row, text, ha="center", va="center", fontsize=6.8, color=color, fontweight="bold")

    ax.tick_params(axis="both", length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)

    cbar = plt.colorbar(image, ax=ax, fraction=0.03, pad=0.02)
    cbar.set_ticks([-1, -0.6, -0.2, 0.2, 0.6, 1])
    cbar.ax.tick_params(labelsize=10)

    fig.savefig(output_path, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    cmap = LinearSegmentedColormap.from_list(
        "corr_green_white_red",
        ["#62c45b", "#f7f7f7", "#f05a5a"],
        N=256,
    )

    for config in DATASET_CONFIGS:
        frame = load_frame(config["path"], config["columns"])
        draw_heatmap(config["output"], frame, config["label"], cmap)
        print(config["output"])


if __name__ == "__main__":
    main()
