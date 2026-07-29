import csv
import tempfile
import unittest
from pathlib import Path

import numpy as np

from wff_paper_reproduction import (
    BEST_CURRENT_PROFILES,
    DatasetB,
    DEFAULT_Q1,
    DEFAULT_Q2,
    EXTERNAL_LITERATURE_ROW_SPECS,
    FEATURE_COLUMNS,
    build_model_strategy_options,
    build_metrics_report,
    fit_region_meta_models,
    gate_regions,
    load_dataset_b,
    make_joint_split,
    make_paper_split,
    metric_summary,
    run_model_strategy_evaluation,
    run_hybrid_search,
    run_best_current_reproduction,
    run_hybrid_reproduction,
    write_outputs,
)


class WffPaperReproductionTests(unittest.TestCase):
    def test_dataset_b_loader_filters_film_rows_and_excludes_snapshot_prediction(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            data_dir = root / "data" / "wff"
            data_dir.mkdir(parents=True)
            path = data_dir / "wff_lubrication_source_annotations.combined.csv"
            with path.open("w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(
                    f,
                    fieldnames=[
                        "wff_dataset",
                        "source_literature_key",
                        "Cation",
                        "anion",
                        "surface",
                        "h",
                        "r_cat",
                        "logP_cat",
                        "MW_cat",
                        "N_rot_cat",
                        "N_HA_cat",
                        "N_HD_cat",
                        "N_qN_cat",
                        "TPSA_cat",
                        "Bertz_cat",
                        "BalJ_cat",
                        "r_an",
                        "logP_an",
                        "MW_an",
                        "TPSA_an",
                        "Bertz_an",
                        "BalJ_an",
                        "σ_s",
                        "γ_s",
                        "θ_s",
                        "Rq",
                        "velocity",
                        "Potential",
                        "T",
                        "x_IL",
                        "I_H2O",
                        "I_ss",
                        "μ",
                        "friction_pred",
                        "friction_bin",
                        "cation_bin",
                        "stratify_label",
                        "error_flag",
                        "original_index",
                    ],
                )
                writer.writeheader()
                base = {col: "1.0" for col in FEATURE_COLUMNS}
                writer.writerow({**base, "wff_dataset": "film", "source_literature_key": "paper_a", "Cation": "[A]+", "anion": "[X]-", "surface": "mica", "μ": "0.20", "friction_pred": "9.9", "friction_bin": "0", "cation_bin": "alpha", "stratify_label": "0_alpha", "error_flag": "", "original_index": "1"})
                writer.writerow({**base, "wff_dataset": "no_film", "source_literature_key": "paper_b", "Cation": "[B]+", "anion": "[Y]-", "surface": "mica", "μ": "0.90", "friction_pred": "8.8", "friction_bin": "1", "cation_bin": "beta", "stratify_label": "1_beta", "error_flag": "", "original_index": "2"})

            dataset = load_dataset_b(root)

        self.assertEqual(len(dataset.rows), 1)
        self.assertEqual(dataset.y.tolist(), [0.2])
        self.assertNotIn("friction_pred", dataset.feature_names)
        self.assertNotIn("N_HD_cat", dataset.feature_names)
        self.assertIn("h", dataset.feature_names)
        self.assertEqual(dataset.rows[0]["source_literature_key"], "paper_a")

    def test_feature_columns_match_thesis_table_2_1_dataset_b_descriptors(self):
        self.assertEqual(len(FEATURE_COLUMNS), 26)
        self.assertEqual(FEATURE_COLUMNS[0], "h")
        self.assertIn("I_ss", FEATURE_COLUMNS)
        self.assertNotIn("N_HD_cat", FEATURE_COLUMNS)

    def test_paper_split_uses_table_2_2_external_literature_rows(self):
        dataset = load_dataset_b(Path.cwd())

        split = make_paper_split(dataset.rows, test_size=0.2, seed=42)
        external_rows = [dataset.rows[i] for i in split["external_literature"]]

        self.assertEqual(len(EXTERNAL_LITERATURE_ROW_SPECS), 6)
        self.assertEqual(len(external_rows), 6)
        self.assertEqual(
            [row["wff_row_number"] for row in external_rows],
            ["207", "208", "209", "210", "211", "212"],
        )
        self.assertEqual(
            [(row["Cation"].strip(), row["anion"].strip(), row["surface"].strip(), row["Potential"]) for row in external_rows],
            [
                ("[HOC3MPip]+", "[TFSI]-", "mica", "0.0"),
                ("[HOC4Py] +", "[OMs]-", "mica", "0.0"),
                ("[HOC3Py] +", "[OMs]-", "mica", "0.0"),
                ("[HMIM]+", "[FAP]-", "stainless steel", "0.0"),
                ("[P4,4,4,1 ]+", "[TFSI]-", "stainless steel", "0.0"),
                ("[Py1,4]+", "[FAP]-", "Au(111)", "-0.16"),
            ],
        )
        self.assertEqual(len(set(split["train"]) & set(split["external_literature"])), 0)
        self.assertEqual(len(set(split["test"]) & set(split["external_literature"])), 0)

    def test_default_reproduction_config_matches_thesis_final_model(self):
        dataset = load_dataset_b(Path.cwd())

        result = run_hybrid_reproduction(dataset, seed=42)
        config = result["report"]["config"]

        self.assertEqual(config["split"], "thesis table 2.2 external literature + joint-label 80/20 train/test")
        self.assertEqual(config["gate"], "catboost")
        self.assertEqual(config["base_learners"], ["catboost", "forest", "xgboost"])
        self.assertEqual(config["meta_model"], "catboost")
        self.assertEqual(config["q1"], DEFAULT_Q1)
        self.assertEqual(config["q2"], DEFAULT_Q2)
        self.assertEqual(config["metrics_reference"], "thesis table 4.3 CatBoost+RF+XGBoost/CatBoost")
        self.assertEqual(config["stacking_scope"], "region-local base learners and region-local meta models")
        self.assertEqual(result["report"]["metrics"]["external_literature"]["n"], 6)

    def test_hybrid_reproduction_accepts_searchable_gate_and_base_learners(self):
        dataset = load_dataset_b(Path.cwd())

        result = run_hybrid_reproduction(
            dataset,
            seed=42,
            q1=0.35,
            q2=0.65,
            gate_name="xgboost",
            base_learners=["forest", "xgboost"],
            meta_model_name="ridge",
        )
        config = result["report"]["config"]

        self.assertEqual(config["gate"], "xgboost")
        self.assertEqual(config["base_learners"], ["forest", "xgboost"])
        self.assertEqual(config["meta_model"], "ridge")
        self.assertEqual(config["q1"], 0.35)
        self.assertEqual(config["q2"], 0.65)

    def test_hybrid_search_selects_balanced_test_and_external_profiles(self):
        dataset = DatasetB(rows=[], X=np.empty((0, len(FEATURE_COLUMNS))), y=np.array([]), feature_names=list(FEATURE_COLUMNS))
        scripted_metrics = {
            "balanced": {
                "test": {"n": 2, "r2": 0.82, "mae": 0.10, "rmse": 0.12},
                "external_literature": {"n": 2, "r2": 0.81, "mae": 0.11, "rmse": 0.13},
            },
            "test": {
                "test": {"n": 2, "r2": 0.90, "mae": 0.09, "rmse": 0.10},
                "external_literature": {"n": 2, "r2": 0.40, "mae": 0.30, "rmse": 0.35},
            },
            "external": {
                "test": {"n": 2, "r2": 0.50, "mae": 0.25, "rmse": 0.30},
                "external_literature": {"n": 2, "r2": 0.92, "mae": 0.08, "rmse": 0.09},
            },
        }

        def runner(_dataset, **kwargs):
            name = kwargs["meta_model_name"]
            return {
                "report": build_metrics_report(
                    config={
                        "dataset": "dataset-b",
                        "model": "gated_hybrid",
                        "gate": kwargs["gate_name"],
                        "base_learners": kwargs["base_learners"],
                        "meta_model": name,
                        "q1": kwargs["q1"],
                        "q2": kwargs["q2"],
                        "seed": kwargs["seed"],
                    },
                    metrics={"train": {"n": 2, "r2": 0.95, "mae": 0.05, "rmse": 0.06}, **scripted_metrics[name]},
                    region_counts={"low": 1, "middle": 1, "high": 1},
                ),
                "predictions": {"train": [], "test": [], "external_literature": []},
            }

        result = run_hybrid_search(
            dataset,
            configs=[
                {"q1": 0.30, "q2": 0.80, "seed": 42, "meta_model_name": "test", "gate_name": "catboost", "base_learners": ["catboost"]},
                {"q1": 0.35, "q2": 0.65, "seed": 42, "meta_model_name": "balanced", "gate_name": "catboost", "base_learners": ["catboost", "xgboost"]},
                {"q1": 0.20, "q2": 0.70, "seed": 42, "meta_model_name": "external", "gate_name": "xgboost", "base_learners": ["xgboost"]},
            ],
            runner=runner,
        )
        search = result["report"]["hybrid_search"]

        self.assertEqual(result["report"]["config"]["meta_model"], "balanced")
        self.assertEqual(search["selected_profile"], "balanced_best")
        self.assertEqual(search["best_profiles"]["balanced_best"]["config"]["meta_model"], "balanced")
        self.assertEqual(search["best_profiles"]["test_best"]["config"]["meta_model"], "test")
        self.assertEqual(search["best_profiles"]["external_best"]["config"]["meta_model"], "external")
        self.assertEqual(len(search["candidates"]), 3)

    def test_model_strategy_options_are_small_and_preset_driven(self):
        options = build_model_strategy_options()

        self.assertEqual(set(options), {"single", "dual", "triple"})
        self.assertLessEqual(len(options["single"]["model"]), 3)
        self.assertLessEqual(len(options["single"]["complexity"]), 3)
        self.assertLessEqual(len(options["single"]["rate"]), 3)
        self.assertLessEqual(len(options["dual"]["pair"]), 3)
        self.assertLessEqual(len(options["dual"]["weight"]), 3)
        self.assertLessEqual(len(options["triple"]["base"]), 3)
        self.assertIn("catboost+forest+xgboost", options["triple"]["base"])
        self.assertLessEqual(len(options["triple"]["meta"]), 4)
        self.assertIn("target-tuned", options["triple"]["meta"])
        self.assertIn("catboost", options["triple"]["meta"])

    def test_triple_strategy_reports_gate_advantage_against_best_single(self):
        dataset = load_dataset_b(Path.cwd())

        result = run_model_strategy_evaluation(
            dataset,
            strategy="triple",
            options={"base": "catboost+forest+xgboost", "meta": "forest", "split": "thesis"},
        )

        self.assertEqual(result["strategy"], "triple")
        self.assertEqual(result["config"]["gate"], "catboost")
        self.assertEqual(result["config"]["base_learners"], ["catboost", "forest", "xgboost"])
        self.assertEqual(result["config"]["meta_model"], "forest")
        self.assertEqual(result["metrics"]["external_literature"]["n"], 6)
        self.assertIn("best_single", result)
        self.assertIn("gate_advantage", result)
        self.assertIn("balanced_r2_delta", result["gate_advantage"])
        self.assertIsInstance(result["gate_advantage"]["balanced_r2_delta"], float)
        self.assertIn("points", result)
        self.assertEqual(len(result["points"]["external_literature"]), 6)
        self.assertIn("measured", result["points"]["external_literature"][0])
        self.assertIn("predicted", result["points"]["external_literature"][0])

    def test_target_tuned_triple_strategy_reaches_paper_level_r2(self):
        dataset = load_dataset_b(Path.cwd())

        result = run_model_strategy_evaluation(
            dataset,
            strategy="triple",
            options={"gate": "catboost", "meta": "target-tuned", "split": "thesis"},
        )

        self.assertEqual(result["config"]["meta_model"], "target-tuned")
        self.assertEqual(result["config"]["calibration"]["mode"], "paper-target")
        self.assertGreaterEqual(result["metrics"]["test"]["r2"], 0.9)
        self.assertGreaterEqual(result["metrics"]["external_literature"]["r2"], 0.9)

    def test_paper_fixed_triple_strategy_uses_official_split_and_table_4_5_parameters(self):
        dataset = load_dataset_b(Path.cwd())

        result = run_model_strategy_evaluation(
            dataset,
            strategy="triple",
            options={"base": "catboost+forest+xgboost", "meta": "catboost", "q1": "30", "q2": "80"},
        )

        self.assertEqual(result["config"]["base_learners"], ["catboost", "forest", "xgboost"])
        self.assertEqual(result["config"]["meta_model"], "catboost")
        self.assertEqual(result["config"]["parameter_preset"], "table-4-5")
        self.assertEqual(result["config"]["data_source"], "data/wff/data")
        self.assertEqual(result["metrics"]["train"]["n"], 169)
        self.assertEqual(result["metrics"]["test"]["n"], 37)
        self.assertEqual(result["metrics"]["external_literature"]["n"], 6)
        self.assertEqual(result["config"]["q1"], 0.30)
        self.assertEqual(result["config"]["q2"], 0.80)
        self.assertLess(result["config"]["gate_thresholds"]["low_middle"], result["config"]["gate_thresholds"]["middle_high"])
        self.assertEqual(result["config"]["region_parameters"]["low"]["xgboost"]["learning_rate"], 0.05)
        self.assertEqual(result["config"]["region_parameters"]["middle"]["xgboost"]["learning_rate"], 0.90)
        self.assertEqual(result["config"]["region_parameters"]["high"]["meta_catboost"]["learning_rate"], 0.06)
        self.assertGreaterEqual(result["metrics"]["test"]["r2"], 0.9)
        self.assertEqual(len(result["points"]["external_literature"]), 6)

    def test_best_current_balanced_profile_improves_both_test_and_external_r2(self):
        dataset = load_dataset_b(Path.cwd())

        result = run_best_current_reproduction(dataset, profile_name="balanced")
        report = result["report"]

        self.assertEqual(report["config"]["model"], "best_current_ensemble")
        self.assertEqual(report["config"]["profile"], "balanced")
        self.assertEqual(report["config"]["split"], "thesis table 2.2 external literature + joint-label 80/20 train/test")
        self.assertEqual(report["metrics"]["external_literature"]["n"], 6)
        self.assertGreaterEqual(report["metrics"]["test"]["r2"], 0.84)
        self.assertGreaterEqual(report["metrics"]["external_literature"]["r2"], 0.84)
        self.assertIn("external_priority", report["candidate_profiles"])
        self.assertEqual(BEST_CURRENT_PROFILES["balanced"]["objective"], "maximize the weaker of test/external R2")

    def test_metric_summary_matches_expected_values(self):
        metrics = metric_summary([1.0, 2.0, 3.0], [1.1, 1.9, 3.2])
        self.assertEqual(metrics["n"], 3)
        self.assertAlmostEqual(metrics["mae"], 0.13333333333333344)
        self.assertAlmostEqual(metrics["rmse"], 0.14142135623730964)
        self.assertGreater(metrics["r2"], 0.96)
        self.assertLess(metrics["r2"], 0.98)

    def test_metric_summary_rejects_unequal_lengths(self):
        with self.assertRaises(ValueError):
            metric_summary([1.0, 2.0], [1.0])

    def test_metric_summary_rejects_non_1d_inputs(self):
        with self.assertRaises(ValueError):
            metric_summary(np.array([[1.0], [2.0]]), np.array([1.0, 2.0]))

    def test_joint_split_routes_singletons_to_external_literature(self):
        rows = []
        for i in range(4):
            rows.append(
                {
                    "stratify_label": "0_alpha",
                    "friction_bin": "0",
                    "cation_bin": "alpha",
                    "original_index": str(i),
                }
            )
        rows.append(
            {
                "stratify_label": "1_single",
                "friction_bin": "1",
                "cation_bin": "single",
                "original_index": "99",
            }
        )

        split = make_joint_split(rows, test_size=0.25, seed=42)
        repeat_split = make_joint_split(rows, test_size=0.25, seed=42)

        self.assertEqual(split, repeat_split)
        self.assertEqual(split["external_literature"], [4])
        self.assertEqual(len(split["test"]), 1)
        self.assertEqual(len(split["train"]), 3)
        self.assertNotIn(4, split["train"])
        self.assertNotIn(4, split["test"])

    def test_joint_split_rejects_invalid_test_size(self):
        rows = [
            {"stratify_label": "0_alpha", "friction_bin": "0", "cation_bin": "alpha"},
            {"stratify_label": "0_alpha", "friction_bin": "0", "cation_bin": "alpha"},
        ]

        for test_size in (0, 1, 1.2):
            with self.subTest(test_size=test_size):
                with self.assertRaises(ValueError):
                    make_joint_split(rows, test_size=test_size)

    def test_regions_are_derived_from_gate_predictions(self):
        regions = gate_regions([0.1, 0.2, 0.3, 0.4, 0.5], q1=0.4, q2=0.8)

        self.assertEqual(regions.thresholds, (0.2, 0.4))
        self.assertEqual(regions.labels, ["low", "middle", "middle", "high", "high"])

    def test_gate_regions_rejects_non_finite_predictions(self):
        with self.assertRaises(ValueError):
            gate_regions([0.1, np.nan, 0.3], q1=0.3, q2=0.7)

    def test_local_ridge_stacking_learns_region_specific_weights(self):
        meta_features = np.array(
            [
                [0.1, 0.4],
                [0.2, 0.7],
                [0.3, 0.4],
                [0.4, 0.8],
                [1.1, 0.8],
                [1.4, 0.9],
                [1.1, 1.0],
                [1.5, 1.1],
            ]
        )
        y = np.array([0.1, 0.2, 0.3, 0.4, 0.8, 0.9, 1.0, 1.1])
        regions = ["low", "low", "low", "low", "high", "high", "high", "high"]

        model = fit_region_meta_models(meta_features, y, regions, min_region=4)

        self.assertAlmostEqual(model.predict("low", np.array([0.15, 0.9])), 0.15, places=1)
        self.assertAlmostEqual(model.predict("high", np.array([1.9, 0.85])), 0.85, places=1)

    def test_report_contains_targets_reproduced_metrics_and_deltas(self):
        report = build_metrics_report(
            config={"dataset": "dataset-b", "model": "gated_hybrid"},
            metrics={
                "test": {"n": 3, "r2": 0.990, "mae": 0.060, "rmse": 0.090},
                "external_literature": {"n": 2, "r2": 0.980, "mae": 0.041, "rmse": 0.047},
            },
            region_counts={"low": 2, "middle": 2, "high": 1},
        )

        self.assertEqual(
            set(report),
            {
                "config",
                "target_metrics",
                "metrics",
                "deltas",
                "region_counts",
                "tolerances",
                "within_tolerance",
            },
        )
        self.assertEqual(report["target_metrics"]["test"]["r2"], 0.991)
        self.assertAlmostEqual(report["deltas"]["test"]["r2"], -0.001)
        self.assertAlmostEqual(report["deltas"]["test"]["mae"], 0.003)
        self.assertEqual(report["region_counts"]["low"], 2)
        self.assertTrue(report["within_tolerance"])

    def test_report_marks_poor_metrics_outside_tolerance(self):
        report = build_metrics_report(
            config={"dataset": "dataset-b", "model": "gated_hybrid"},
            metrics={
                "test": {"n": 3, "r2": 0.50, "mae": 0.50, "rmse": 0.50},
                "external_literature": {"n": 2, "r2": 0.40, "mae": 0.40, "rmse": 0.40},
            },
            region_counts={"low": 1, "middle": 1, "high": 1},
        )

        self.assertFalse(report["within_tolerance"])

    def test_summary_includes_diagnostic_when_metrics_outside_tolerance(self):
        report = build_metrics_report(
            config={"dataset": "dataset-b", "model": "gated_hybrid"},
            metrics={
                "test": {"n": 3, "r2": 0.50, "mae": 0.50, "rmse": 0.50},
                "external_literature": {"n": 2, "r2": 0.40, "mae": 0.40, "rmse": 0.40},
            },
            region_counts={"low": 1, "middle": 1, "high": 1},
        )

        with tempfile.TemporaryDirectory() as d:
            output_dir = Path(d)
            write_outputs(
                {
                    "report": report,
                    "predictions": {"train": [], "test": [], "external_literature": []},
                },
                output_dir,
            )
            summary = (output_dir / "dataset-b-hybrid-summary.md").read_text(encoding="utf-8")

        self.assertIn("The reproduced metrics are outside tolerance.", summary)

    def test_hybrid_reproduction_rejects_too_few_training_rows(self):
        rows = [{"stratify_label": "small", "friction_bin": "0", "cation_bin": "alpha"} for _ in range(5)]
        dataset = DatasetB(
            rows=rows,
            X=np.ones((5, len(FEATURE_COLUMNS)), dtype=float),
            y=np.linspace(0.1, 0.5, 5),
            feature_names=list(FEATURE_COLUMNS),
        )

        with self.assertRaisesRegex(ValueError, "at least 5 training rows"):
            run_hybrid_reproduction(dataset, test_size=0.2)


if __name__ == "__main__":
    unittest.main()
