# -*- coding: utf-8 -*-
"""
ML-WFF 薄膜摩擦系数预测脚本。

用途：
- 读取 train.csv / test.csv / literature.csv，预测目标列 μ。
- 使用 Gate=CatBoost OOF 做 low/mid/high 分段。
- 段内专家模型为 XGBoost + CatBoost + RandomForest。
- 融合器为 CatBoost Meta；段内样本不足时回退到线性融合。
- 以 test.csv 的分段 R2 选择参数，并在 literature.csv 上做外部验证。
- 输出参数筛选结果、最终评估结果和散点图到 results_STABLE_TESTSELECT_CBMETAGRID_* 目录。

模型流程：
- Gate：CatBoost OOF 预测用于确定分位阈值；再用全量 Gate 预测用于 train/test/exp 分段
- Base：XGB / CB 采用早停+回灌重训；RF 直接训练（无早停）
- Meta：段内 3 维输入（BaseXGB_pred, BaseCB_pred, BaseRF_pred）；样本不足回退线性融合（非负+归一化+截距）
- 选优：枚举 BaseXGB × BaseCB × BaseRF × MetaCB 参数组合，以 test 分段 R2 选优（low/mid/high 各选各的）
- 终评：用选中的三段方案对外部验证集评估 + 输出两张散点图
"""

import os
import warnings
from copy import deepcopy
from itertools import product
from collections import namedtuple
from pathlib import Path
import numpy as np
import pandas as pd

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sklearn.model_selection import StratifiedKFold, KFold, train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score, mean_absolute_error, mean_squared_error
from sklearn.ensemble import RandomForestRegressor

from catboost import CatBoostRegressor
from xgboost import XGBRegressor
from tqdm.auto import tqdm

warnings.filterwarnings("ignore")

BARFMT = "{l_bar}{bar}| {n_fmt}/{total_fmt} ({percentage:3.0f}%) [{elapsed}<{remaining}]"

# =========================
# 配色（与你原代码一致）
# =========================
color_low,   color_tr_low   = "#1ee810", "#0b49e7"
color_mid,   color_tr_mid   = "#00aaff", "#ff66cc"
color_high,  color_tr_high  = "#eff306", "#e60e0e"

# =========================
# 参数网格（与你原代码一致，但 RF 严格对齐）
# =========================
xgb_base_param_grid = {
    "n_estimators":  [200],
    "learning_rate": [0.05, 0.2, 0.9],
    "max_depth":     [4],
    "reg_lambda":    [0.1, 1, 7],
}
cb_param_grid = {
    "iterations":     [800],
    "learning_rate":  [0.03, 0.12, 0.58],
    "depth":          [5],
    "l2_leaf_reg":    [0.9, 10],
}
# ✅ RF：只用你网格里真实存在的字段（避免 KeyError）
rf_param_grid = {
    "n_estimators": [60],
    "max_depth":    [7, 9],
    "max_features": [0.4, 0.8],
}

cb_meta_param_grid = {
    "iterations":    [2000],
    "learning_rate": [0.03, 0.06, 0.3],
    "depth":         [2, 3, 4],
    "l2_leaf_reg":   [0.5, 1.0, 3.0],
    "od_wait":       [50],
}

xgbb_keys = list(xgb_base_param_grid)
cb_keys   = list(cb_param_grid)
rf_keys   = list(rf_param_grid)
cbm_keys  = list(cb_meta_param_grid)

xgbb_values = list(product(*xgb_base_param_grid.values()))
cb_values   = list(product(*cb_param_grid.values()))
rf_values   = list(product(*rf_param_grid.values()))
cbm_values  = list(product(*cb_meta_param_grid.values()))

# =========================
# 数据路径
# =========================
DATA_DIR = Path(__file__).resolve().parent
train_path = DATA_DIR / "train.csv"
test_path  = DATA_DIR / "test.csv"
exp_path   = DATA_DIR / "literature.csv"  # 如需评估实验集，可改为 DATA_DIR / "experiment.csv"
target_col = "μ"

# =========================
# 读 CSV（稳健：多编码兜底）
# =========================
def read_csv_safe(path):
    encodings = ["utf-8", "utf-8-sig", "gbk", "gb18030", "latin1"]
    last_err = None
    for enc in encodings:
        try:
            return pd.read_csv(path, encoding=enc)
        except Exception as e:
            last_err = e
    raise last_err

train_df = read_csv_safe(train_path)
test_df  = read_csv_safe(test_path)
exp_df   = read_csv_safe(exp_path)

# =========================
# 特征列（与你原脚本一致）
# =========================
feature_cols = list(train_df.columns[4:30])
if target_col in feature_cols:
    feature_cols.remove(target_col)

# =========================
# 对齐 + 数值化 + 缺失值处理（工程稳健关键）
# =========================
def align_features(df, feature_cols, ref_means=None):
    df = df.copy()
    for c in feature_cols:
        if c not in df.columns:
            df[c] = np.nan
    X = df[feature_cols].apply(pd.to_numeric, errors="coerce")
    if ref_means is not None:
        X = X.fillna(ref_means)
    return X

X_train = align_features(train_df, feature_cols, ref_means=None)
y_train = pd.to_numeric(train_df[target_col], errors="coerce").astype(float).reset_index(drop=True)

# ✅ 训练集也必须填补 NaN，否则 StandardScaler 会崩
train_means = X_train.mean().fillna(0.0)
X_train = X_train.fillna(train_means)

X_test = align_features(test_df, feature_cols, ref_means=train_means)
y_test = pd.to_numeric(test_df[target_col], errors="coerce").astype(float).reset_index(drop=True)

X_exp  = align_features(exp_df, feature_cols, ref_means=train_means)
y_exp  = pd.to_numeric(exp_df[target_col], errors="coerce").astype(float).reset_index(drop=True)

# =========================
# 小工具
# =========================
def save_fig(fig, folder, suffix):
    os.makedirs(folder, exist_ok=True)
    out = os.path.join(folder, f"{suffix}.png")
    fig.savefig(out, dpi=300, bbox_inches="tight")
    plt.close(fig)

def safe_r2(y_true, y_pred):
    try:
        y_true = np.asarray(y_true); y_pred = np.asarray(y_pred)
        if len(y_true) < 2 or len(y_pred) < 2:
            return np.nan
        return r2_score(y_true, y_pred)
    except Exception:
        return np.nan

def nrmse(y_true, y_pred):
    y_true = np.asarray(y_true); y_pred = np.asarray(y_pred)
    if len(y_true) == 0:
        return np.nan
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    denom = np.max(y_true) - np.min(y_true)
    if denom <= 0:
        denom = max(np.mean(np.abs(y_true)), 1e-8)
    return rmse / denom

def fmt3(x):
    try:
        return f"{float(np.ravel([x])[0]):.3f}"
    except Exception:
        return str(x)

def minmax_nonempty(*arrays):
    arrs = [np.asarray(a) for a in arrays if a is not None and len(a) > 0]
    if len(arrs) == 0:
        return [0.0, 1.0]
    return [min(a.min() for a in arrs), max(a.max() for a in arrs)]

def compute_metrics(y_true, y_pred):
    if y_true is None or y_pred is None:
        return (np.nan, np.nan, np.nan, np.nan)
    y_true = np.asarray(y_true); y_pred = np.asarray(y_pred)
    if len(y_true) == 0 or len(y_pred) == 0:
        return (np.nan, np.nan, np.nan, np.nan)
    r2 = safe_r2(y_true, y_pred)
    mae = mean_absolute_error(y_true, y_pred) if len(y_true) > 0 else np.nan
    rmse = np.sqrt(mean_squared_error(y_true, y_pred)) if len(y_true) > 0 else np.nan
    return (r2, mae, rmse, nrmse(y_true, y_pred))

# =========================
# 回归分层：分箱失败则回退到 KFold（工程稳健）
# =========================
def bin_y_for_stratify(y, n_bins=10):
    y = pd.Series(y).astype(float)
    try:
        return pd.qcut(y, q=n_bins, duplicates="drop").cat.codes.values
    except Exception:
        bins = min(n_bins, max(2, int(np.sqrt(len(y)))))
        return pd.cut(y, bins=bins, duplicates="drop").codes

def build_fold_indices(y, n_splits=5, random_state=42):
    y_bins = bin_y_for_stratify(y, n_bins=10)
    try:
        vc = pd.Series(y_bins).value_counts()
        if vc.min() >= n_splits and len(vc) >= 2:
            skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=random_state)
            return list(skf.split(np.zeros(len(y)), y_bins))
    except Exception:
        pass
    kf = KFold(n_splits=n_splits, shuffle=True, random_state=random_state)
    return list(kf.split(np.zeros(len(y))))

# =========================
# 早停 + 回灌重训（CatBoost / XGBoost）
# ✅ 修复 best_iteration 0/0-based 问题：最终迭代数 = best_iter + 1
# =========================
def fit_cb_with_early_stopping(
    X_s, y, params, fold_indices, fold_id=0,
    loss_function="RMSE", eval_metric="RMSE",
    od_wait=50, random_seed=42
):
    tr_idx, va_idx = fold_indices[min(fold_id, len(fold_indices) - 1)]
    y_arr = y.values if hasattr(y, "values") else np.asarray(y)

    X_tr, y_tr = X_s[tr_idx], y_arr[tr_idx]
    X_va, y_va = X_s[va_idx], y_arr[va_idx]

    tmp = CatBoostRegressor(
        **params,
        loss_function=loss_function,
        eval_metric=eval_metric,
        od_type="Iter",
        od_wait=int(od_wait),
        use_best_model=True,
        random_seed=random_seed,
        verbose=False
    )
    tmp.fit(X_tr, y_tr, eval_set=(X_va, y_va), verbose=False)

    best_iter = tmp.get_best_iteration()
    if best_iter is None:
        best_iter = int(params.get("iterations", 2000)) - 1
    best_iter = max(0, int(best_iter))

    final_params = deepcopy(params)
    final_params["iterations"] = int(best_iter) + 1  # ✅ 0-based → 轮数
    final = CatBoostRegressor(
        **final_params,
        loss_function=loss_function,
        eval_metric=eval_metric,
        random_seed=random_seed,
        verbose=False
    )
    final.fit(X_s, y_arr, verbose=False)
    return final, int(best_iter) + 1

def fit_xgb_with_early_stopping(
    X_s, y, params, fold_indices, fold_id=0,
    eval_metric="rmse", early_stopping_rounds=50, random_state=42
):
    tr_idx, va_idx = fold_indices[min(fold_id, len(fold_indices) - 1)]
    y_arr = y.values if hasattr(y, "values") else np.asarray(y)

    X_tr, y_tr = X_s[tr_idx], y_arr[tr_idx]
    X_va, y_va = X_s[va_idx], y_arr[va_idx]

    tmp = XGBRegressor(
        **params,
        subsample=1.0,
        colsample_bytree=1.0,
        min_child_weight=1.0,
        gamma=0.0,
        random_state=random_state,
        n_jobs=-1,
        tree_method="hist",
        objective="reg:squarederror",
        eval_metric=eval_metric,
        early_stopping_rounds=int(early_stopping_rounds),
    )
    tmp.fit(
        X_tr, y_tr,
        eval_set=[(X_va, y_va)],
        verbose=False
    )

    best_iter = getattr(tmp, "best_iteration", None)
    if best_iter is None:
        best_iter = int(params.get("n_estimators", 200)) - 1
    best_iter = max(0, int(best_iter))

    final_params = params.copy()
    final_params["n_estimators"] = int(best_iter) + 1  # ✅ 0-based → 轮数
    final = XGBRegressor(
        **final_params,
        subsample=1.0,
        colsample_bytree=1.0,
        min_child_weight=1.0,
        gamma=0.0,
        random_state=random_state,
        n_jobs=-1,
        tree_method="hist",
        objective="reg:squarederror",
        eval_metric=eval_metric,
    )
    final.fit(X_s, y_arr)
    return final, int(best_iter) + 1

# =========================
# Gate：用 OOF 预测确定阈值（更稳），同时训练全量 Gate 做分段预测
# =========================
n_splits = 5
fold_indices = build_fold_indices(y_train, n_splits=n_splits, random_state=42)

BaseFold = namedtuple("BaseFold", "tr_idx va_idx yhat_tr yhat_va scaler")
def build_gate_oof(X, y, fold_indices):
    y_hat_oof = np.zeros(len(y), dtype=np.float32)
    base_folds = []

    for tr_idx, va_idx in tqdm(fold_indices, desc="Gate OOF 预测", bar_format=BARFMT):
        X_tr, y_tr = X.iloc[tr_idx], y.iloc[tr_idx]
        X_va, y_va = X.iloc[va_idx], y.iloc[va_idx]

        scaler = StandardScaler().fit(X_tr)
        X_tr_s = scaler.transform(X_tr)
        X_va_s = scaler.transform(X_va)

        gate = CatBoostRegressor(
            iterations=1500, depth=3, learning_rate=0.58,
            l2_leaf_reg=0.9, loss_function="RMSE", eval_metric="RMSE",
            od_type="Iter", od_wait=200, use_best_model=True,
            verbose=False, random_seed=42
        )
        gate.fit(X_tr_s, y_tr, eval_set=(X_va_s, y_va), verbose=False)

        yhat_tr = gate.predict(X_tr_s).astype(np.float32)
        yhat_va = gate.predict(X_va_s).astype(np.float32)
        y_hat_oof[va_idx] = yhat_va

        base_folds.append(BaseFold(
            tr_idx=np.array(tr_idx, dtype=np.int64),
            va_idx=np.array(va_idx, dtype=np.int64),
            yhat_tr=yhat_tr, yhat_va=yhat_va, scaler=scaler
        ))
    return y_hat_oof, base_folds

print("⏳ 构建 Gate 的 OOF 预测（用于阈值）……")
y_hat0_oof, base_folds = build_gate_oof(X_train, y_train, fold_indices)
print("✅ Gate OOF 完成。")

# 全量 scaler（用于全量 Gate 分段与后续所有模型）
global_scaler = StandardScaler().fit(X_train)
X_train_s_full = global_scaler.transform(X_train)
X_test_s       = global_scaler.transform(X_test)
X_exp_s        = global_scaler.transform(X_exp)

# 全量 Gate（早停+回灌）
_gate_params = dict(iterations=1500, depth=3, learning_rate=0.58, l2_leaf_reg=0.9)
gate_full, gate_best_iter = fit_cb_with_early_stopping(
    X_train_s_full, y_train, _gate_params, fold_indices, fold_id=0, od_wait=200
)
print(f"[Gate CatBoost] best_iteration(used) = {gate_best_iter}")

y_hat0_full_train = gate_full.predict(X_train_s_full)
y_hat0_test       = gate_full.predict(X_test_s)
y_hat0_exp        = gate_full.predict(X_exp_s)

# =========================
# 段内训练：BaseXGB/CB/RF + MetaCB(3维) 或线性回退
# =========================
def train_full_and_build_meta(
    xgb_base_params, cb_params, rf_params, cb_meta_params,
    X_train_s_full, y_train,
    thr_low, thr_high,
    min_samples=8,
    base_full_pred_train=None,
    fold_indices=None,
    fold_id_for_es=0,
    xgb_es_rounds=50,
    random_state=42
):
    if base_full_pred_train is None:
        raise ValueError("need base_full_pred_train")
    if fold_indices is None or len(fold_indices) == 0:
        raise ValueError("fold_indices is required")

    # 1) Base XGB
    xgb_base_m, xgb_base_best_iter = fit_xgb_with_early_stopping(
        X_train_s_full, y_train, xgb_base_params,
        fold_indices=fold_indices, fold_id=fold_id_for_es,
        early_stopping_rounds=xgb_es_rounds, random_state=random_state
    )

    # 2) Base CB
    cb_m, cb_best_iter = fit_cb_with_early_stopping(
        X_train_s_full, y_train, cb_params,
        fold_indices=fold_indices, fold_id=fold_id_for_es, od_wait=50,
        random_seed=random_state
    )

    # 3) Base RF（无早停）
    rf_m = RandomForestRegressor(
        **rf_params,
        random_state=random_state,
        n_jobs=-1
    )
    rf_m.fit(X_train_s_full, y_train.values if hasattr(y_train, "values") else np.asarray(y_train))

    # 4) 分段 mask（用全量 Gate 预测）
    base_pred = np.asarray(base_full_pred_train)
    mask_low  = (base_pred <= thr_low)
    mask_mid  = (base_pred >  thr_low) & (base_pred <= thr_high)
    mask_high = (base_pred >  thr_high)

    def fit_meta_for_block(X_block_s, y_block, cb_meta_params_local):
        # 空段直接给默认
        if len(X_block_s) == 0 or len(y_block) == 0:
            return {"fallback": True, "model": None, "w": (1/3, 1/3, 1/3, 0.0)}

        y_blk = y_block.values if hasattr(y_block, "values") else np.asarray(y_block, dtype=float)

        # 生成 3 维 meta 特征
        xgb_pred = xgb_base_m.predict(X_block_s)
        cb_pred  = cb_m.predict(X_block_s)
        rf_pred  = rf_m.predict(X_block_s)
        X_meta   = np.vstack([xgb_pred, cb_pred, rf_pred]).T

        # 样本足够 -> Meta CatBoost（段内 7:3，早停）
        if len(y_blk) >= max(min_samples, 6):
            X_trm, X_valm, y_trm, y_valm = train_test_split(
                X_meta, y_blk, test_size=0.3, random_state=42
            )
            params_copy = deepcopy(cb_meta_params_local)
            od_wait = int(params_copy.pop("od_wait", 50))

            meta_cb = CatBoostRegressor(
                **params_copy,
                loss_function="RMSE",
                eval_metric="RMSE",
                od_type="Iter",
                od_wait=od_wait,
                use_best_model=True,
                random_seed=random_state,
                verbose=False
            )
            meta_cb.fit(X_trm, y_trm, eval_set=(X_valm, y_valm), verbose=False)
            return {"fallback": False, "model": meta_cb, "w": None}

        # 样本不足 -> 线性回退（非负+归一化+截距）
        try:
            reg = LinearRegression(fit_intercept=True).fit(X_meta, y_blk)
            w = np.clip(reg.coef_, 0, None)
            if w.sum() <= 0:
                w = np.array([1/3, 1/3, 1/3], dtype=float)
            else:
                w = w / w.sum()
            b = float(reg.intercept_)
            return {"fallback": True, "model": None, "w": (float(w[0]), float(w[1]), float(w[2]), b)}
        except Exception:
            return {"fallback": True, "model": None, "w": (1/3, 1/3, 1/3, 0.0)}

    X_low_s,  y_low  = X_train_s_full[mask_low],  y_train[mask_low]
    X_mid_s,  y_mid  = X_train_s_full[mask_mid],  y_train[mask_mid]
    X_high_s, y_high = X_train_s_full[mask_high], y_train[mask_high]

    meta_low  = fit_meta_for_block(X_low_s,  y_low,  cb_meta_params)
    meta_mid  = fit_meta_for_block(X_mid_s,  y_mid,  cb_meta_params)
    meta_high = fit_meta_for_block(X_high_s, y_high, cb_meta_params)

    return {
        "xgb_base": xgb_base_m,
        "cb": cb_m,
        "rf": rf_m,
        "meta": {"low": meta_low, "mid": meta_mid, "high": meta_high},
        "train_masks": {"low": mask_low, "mid": mask_mid, "high": mask_high},
        "iters": {"xgb": xgb_base_best_iter, "cb": cb_best_iter},
    }

def meta_predict_block(xgb_base_model, cb_model, rf_model, X_block_s, meta_info):
    if len(X_block_s) == 0:
        return np.array([], dtype=float)
    xgbb_p = xgb_base_model.predict(X_block_s)
    cb_p   = cb_model.predict(X_block_s)
    rf_p   = rf_model.predict(X_block_s)

    if (not meta_info.get("fallback", True)) and (meta_info.get("model", None) is not None):
        X_meta = np.vstack([xgbb_p, cb_p, rf_p]).T
        return meta_info["model"].predict(X_meta)

    w = meta_info.get("w", (1/3, 1/3, 1/3, 0.0))
    w_xgbb, w_cb, w_rf, b = w
    return w_xgbb * xgbb_p + w_cb * cb_p + w_rf * rf_p + b

# =========================
# 按 test 分段 R2 做选优（四重网格）——加 try/except，保证不中断
# =========================
def eval_by_test_r2(
    xgbb_values, cb_values, rf_values, cbm_values,
    xgbb_keys, cb_keys, rf_keys, cbm_keys,
    X_train_s_full, y_train,
    X_test_s, y_test,
    thr_low, thr_high,
    base_full_pred_train, base_full_pred_test,
    min_samples=8,
    fold_indices=None,
    fold_id_for_es=0,
    xgb_es_rounds=50
):
    records = []
    total = len(xgbb_values) * len(cb_values) * len(rf_values) * len(cbm_values)
    pbar = tqdm(total=total, desc="按 test R2 评估超参 (BaseXGB×CB×RF×MetaCB)", bar_format=BARFMT)

    mask_low_test  = (base_full_pred_test <= thr_low)
    mask_mid_test  = (base_full_pred_test >  thr_low) & (base_full_pred_test <= thr_high)
    mask_high_test = (base_full_pred_test >  thr_high)

    X_low_test_s  = X_test_s[mask_low_test]
    X_mid_test_s  = X_test_s[mask_mid_test]
    X_high_test_s = X_test_s[mask_high_test]

    y_low_test  = y_test[mask_low_test].values
    y_mid_test  = y_test[mask_mid_test].values
    y_high_test = y_test[mask_high_test].values

    def _r2(a, b):
        return safe_r2(a, b) if len(a) > 0 else np.nan

    for xgbb_val in xgbb_values:
        xgb_base_params = dict(zip(xgbb_keys, xgbb_val))
        for cb_val in cb_values:
            cb_params = dict(zip(cb_keys, cb_val))
            for rf_val in rf_values:
                rf_params = dict(zip(rf_keys, rf_val))
                for cbm_val in cbm_values:
                    cb_meta_params = dict(zip(cbm_keys, cbm_val))

                    try:
                        pack = train_full_and_build_meta(
                            xgb_base_params, cb_params, rf_params, cb_meta_params,
                            X_train_s_full, y_train,
                            thr_low, thr_high,
                            min_samples=min_samples,
                            base_full_pred_train=base_full_pred_train,
                            fold_indices=fold_indices,
                            fold_id_for_es=fold_id_for_es,
                            xgb_es_rounds=xgb_es_rounds
                        )
                        xb_m, cb_m, rf_m = pack["xgb_base"], pack["cb"], pack["rf"]
                        meta_low  = pack["meta"]["low"]
                        meta_mid  = pack["meta"]["mid"]
                        meta_high = pack["meta"]["high"]

                        y_low_pred  = meta_predict_block(xb_m, cb_m, rf_m, X_low_test_s,  meta_low)  if len(y_low_test)  > 0 else np.array([])
                        y_mid_pred  = meta_predict_block(xb_m, cb_m, rf_m, X_mid_test_s,  meta_mid)  if len(y_mid_test)  > 0 else np.array([])
                        y_high_pred = meta_predict_block(xb_m, cb_m, rf_m, X_high_test_s, meta_high) if len(y_high_test) > 0 else np.array([])

                        r2_low  = _r2(y_low_test,  y_low_pred)
                        r2_mid  = _r2(y_mid_test,  y_mid_pred)
                        r2_high = _r2(y_high_test, y_high_pred)

                        y_all = np.concatenate([a for a in [y_low_test, y_mid_test, y_high_test] if len(a) > 0])
                        y_hat = np.concatenate([a for a in [y_low_pred, y_mid_pred, y_high_pred] if len(a) > 0])
                        r2_all = _r2(y_all, y_hat)

                        records.append({
                            **{f"BASEXGB_{k}": v for k, v in xgb_base_params.items()},
                            **{f"CB_{k}":      v for k, v in cb_params.items()},
                            **{f"RF_{k}":      v for k, v in rf_params.items()},
                            **{f"METACB_{k}":  v for k, v in cb_meta_params.items()},
                            "test_low_R2":  r2_low,
                            "test_mid_R2":  r2_mid,
                            "test_high_R2": r2_high,
                            "test_all_R2":  r2_all,
                        })

                    except Exception:
                        # 任何异常都不让整体崩：记录 NaN 继续
                        records.append({
                            **{f"BASEXGB_{k}": v for k, v in xgb_base_params.items()},
                            **{f"CB_{k}":      v for k, v in cb_params.items()},
                            **{f"RF_{k}":      v for k, v in rf_params.items()},
                            **{f"METACB_{k}":  v for k, v in cb_meta_params.items()},
                            "test_low_R2":  np.nan,
                            "test_mid_R2":  np.nan,
                            "test_high_R2": np.nan,
                            "test_all_R2":  np.nan,
                        })

                    pbar.update(1)

    pbar.close()
    return pd.DataFrame(records)

# =========================
# 绘图（与你原图风格一致，且指标缺失也能画）
# =========================
def plot_train_and_exp(folder, title_suffix,
                       y_low_tr, y_mid_tr, y_high_tr,
                       y_low_tr_pred, y_mid_tr_pred, y_high_tr_pred,
                       y_low_exp, y_mid_exp, y_high_exp,
                       y_low_exp_pred, y_mid_exp_pred, y_high_exp_pred,
                       train_comb_metrics, exp_comb_metrics):
    fig = plt.figure(figsize=(7,6)); ax = plt.gca()

    if len(y_low_tr)>0 and len(y_low_tr_pred)>0:
        ax.scatter(y_low_tr,  y_low_tr_pred,  s=60, c=color_tr_low,  marker='X', edgecolor='k', alpha=0.7, label='Train Low')
    if len(y_mid_tr)>0 and len(y_mid_tr_pred)>0:
        ax.scatter(y_mid_tr,  y_mid_tr_pred,  s=60, c=color_tr_mid,  marker='s', edgecolor='k', alpha=0.7, label='Train Mid')
    if len(y_high_tr)>0 and len(y_high_tr_pred)>0:
        ax.scatter(y_high_tr, y_high_tr_pred, s=60, c=color_tr_high, marker='^', edgecolor='k', alpha=0.7, label='Train High')

    if len(y_low_exp)>0 and len(y_low_exp_pred)>0:
        ax.scatter(y_low_exp,  y_low_exp_pred,  s=60, c=color_low,  marker='o', edgecolor='k', alpha=0.7, label='Exp Low')
    if len(y_mid_exp)>0 and len(y_mid_exp_pred)>0:
        ax.scatter(y_mid_exp,  y_mid_exp_pred,  s=60, c=color_mid,  marker='o', edgecolor='k', alpha=0.7, label='Exp Mid')
    if len(y_high_exp)>0 and len(y_high_exp_pred)>0:
        ax.scatter(y_high_exp, y_high_exp_pred, s=60, c=color_high, marker='o', edgecolor='k', alpha=0.7, label='Exp High')

    lims = minmax_nonempty(
        y_low_tr, y_mid_tr, y_high_tr,
        y_low_exp, y_mid_exp, y_high_exp,
        y_low_tr_pred, y_mid_tr_pred, y_high_tr_pred,
        y_low_exp_pred, y_mid_exp_pred, y_high_exp_pred
    )
    ax.plot(lims, lims, 'k--', lw=1); ax.grid(True, linestyle='--', alpha=0.7)

    tr_r2, tr_mae, tr_rmse, tr_nrmse = train_comb_metrics
    ex_r2, ex_mae, ex_rmse, ex_nrmse = exp_comb_metrics

    ax.text(0.02, 0.82, f"Train (overall)\nR2={fmt3(tr_r2)}, MAE={fmt3(tr_mae)}, RMSE={fmt3(tr_rmse)}, NRMSE={fmt3(tr_nrmse)}",
            transform=ax.transAxes, va='top', fontsize=10, bbox=dict(boxstyle='round', facecolor='white', alpha=0.75))
    ax.text(0.02, 0.70, f"External validation (overall)\nR2={fmt3(ex_r2)}, MAE={fmt3(ex_mae)}, RMSE={fmt3(ex_rmse)}, NRMSE={fmt3(ex_nrmse)}",
            transform=ax.transAxes, va='top', fontsize=10, bbox=dict(boxstyle='round', facecolor='white', alpha=0.75))

    ax.set_xlabel("Actual"); ax.set_ylabel("Predicted")
    ax.set_title(f"All Train + External Validation {title_suffix}")
    ax.legend(ncol=2)
    plt.tight_layout()
    save_fig(fig, folder, "all_train_external")

def plot_train_and_test(folder, title_suffix,
                        y_low_tr, y_mid_tr, y_high_tr,
                        y_low_tr_pred, y_mid_tr_pred, y_high_tr_pred,
                        y_low_te, y_mid_te, y_high_te,
                        y_low_te_pred, y_mid_te_pred, y_high_te_pred):
    y_train_all     = np.concatenate([a for a in [y_low_tr, y_mid_tr, y_high_tr] if len(a) > 0])
    y_train_predall = np.concatenate([a for a in [y_low_tr_pred, y_mid_tr_pred, y_high_tr_pred] if len(a) > 0])
    tr_all = compute_metrics(y_train_all, y_train_predall)

    y_test_all     = np.concatenate([a for a in [y_low_te, y_mid_te, y_high_te] if len(a) > 0])
    y_test_predall = np.concatenate([a for a in [y_low_te_pred, y_mid_te_pred, y_high_te_pred] if len(a) > 0])
    te_all = compute_metrics(y_test_all, y_test_predall)

    fig = plt.figure(figsize=(7,6)); ax = plt.gca()

    if len(y_low_tr)>0 and len(y_low_tr_pred)>0:
        ax.scatter(y_low_tr,  y_low_tr_pred,  s=60, c=color_tr_low,  marker='X', edgecolor='k', alpha=0.7, label='Train Low')
    if len(y_mid_tr)>0 and len(y_mid_tr_pred)>0:
        ax.scatter(y_mid_tr,  y_mid_tr_pred,  s=60, c=color_tr_mid,  marker='s', edgecolor='k', alpha=0.7, label='Train Mid')
    if len(y_high_tr)>0 and len(y_high_tr_pred)>0:
        ax.scatter(y_high_tr, y_high_tr_pred, s=60, c=color_tr_high, marker='^', edgecolor='k', alpha=0.7, label='Train High')

    if len(y_low_te)>0 and len(y_low_te_pred)>0:
        ax.scatter(y_low_te,  y_low_te_pred,  s=60, c=color_low,  marker='o', edgecolor='k', alpha=0.7, label='Test Low')
    if len(y_mid_te)>0 and len(y_mid_te_pred)>0:
        ax.scatter(y_mid_te,  y_mid_te_pred,  s=60, c=color_mid,  marker='o', edgecolor='k', alpha=0.7, label='Test Mid')
    if len(y_high_te)>0 and len(y_high_te_pred)>0:
        ax.scatter(y_high_te, y_high_te_pred, s=60, c=color_high, marker='o', edgecolor='k', alpha=0.7, label='Test High')

    lims = minmax_nonempty(
        y_low_tr, y_mid_tr, y_high_tr,
        y_low_te, y_mid_te, y_high_te,
        y_low_tr_pred, y_mid_tr_pred, y_high_tr_pred,
        y_low_te_pred, y_mid_te_pred, y_high_te_pred
    )
    ax.plot(lims, lims, 'k--', lw=1); ax.grid(True, linestyle='--', alpha=0.7)

    ax.text(0.02, 0.82, f"Train (overall)\nR2={fmt3(tr_all[0])}, MAE={fmt3(tr_all[1])}, RMSE={fmt3(tr_all[2])}, NRMSE={fmt3(tr_all[3])}",
            transform=ax.transAxes, va='top', fontsize=10, bbox=dict(boxstyle='round', facecolor='white', alpha=0.75))
    ax.text(0.02, 0.70, f"Test (overall)\nR2={fmt3(te_all[0])}, MAE={fmt3(te_all[1])}, RMSE={fmt3(te_all[2])}, NRMSE={fmt3(te_all[3])}",
            transform=ax.transAxes, va='top', fontsize=10, bbox=dict(boxstyle='round', facecolor='white', alpha=0.75))

    ax.set_xlabel("Actual"); ax.set_ylabel("Predicted")
    ax.set_title(f"All Train + Test {title_suffix}")
    ax.legend(ncol=2)
    plt.tight_layout()
    save_fig(fig, folder, "all_train_test")

# =========================
# 分位数组合（你可继续加）
# =========================
quantile_pairs = [
    (0.1,0.7),
    (0.1,0.8),
    #(0.1,0.9),
    #(0.3,0.8)
    #(0.3,0.7)
    #(0.2,0.8),
    #(0.3,0.9),
]

MIN_SAMPLES = 8

def pick_best(df_, col):
    df_ = df_.dropna(subset=[col])
    if df_.empty:
        return None
    return df_.loc[df_[col].idxmax()]

def _to_int(x):   return int(round(float(x)))
def _to_float(x): return float(x)

def extract_xgb_base_params_row(row):
    return {
        "n_estimators":  _to_int(row["BASEXGB_n_estimators"]),
        "learning_rate": _to_float(row["BASEXGB_learning_rate"]),
        "max_depth":     _to_int(row["BASEXGB_max_depth"]),
        "reg_lambda":    _to_float(row["BASEXGB_reg_lambda"]),
    }

def extract_cb_params_row(row):
    return {
        "iterations":   _to_int(row["CB_iterations"]),
        "learning_rate":_to_float(row["CB_learning_rate"]),
        "depth":        _to_int(row["CB_depth"]),
        "l2_leaf_reg":  _to_float(row["CB_l2_leaf_reg"]),
    }

# ✅ RF：与网格严格一致（不再用不存在字段）
def extract_rf_params_row(row):
    return {
        "n_estimators": _to_int(row["RF_n_estimators"]),
        "max_depth":    _to_int(row["RF_max_depth"]),
        "max_features": _to_float(row["RF_max_features"]),
    }

def extract_cb_meta_params_row(row):
    return {
        "iterations":   _to_int(row["METACB_iterations"]),
        "learning_rate":_to_float(row["METACB_learning_rate"]),
        "depth":        _to_int(row["METACB_depth"]),
        "l2_leaf_reg":  _to_float(row["METACB_l2_leaf_reg"]),
        "od_wait":      _to_int(row["METACB_od_wait"]),
    }

def extract_fallback_and_w(meta_info):
    fb = bool(meta_info.get("fallback", True))
    if fb:
        w = meta_info.get("w", (np.nan, np.nan, np.nan, np.nan))
        return fb, w[0], w[1], w[2], w[3]
    return fb, np.nan, np.nan, np.nan, np.nan

# =========================
# 主循环：test 选优 -> 三段重训 -> test/exp/train 评估 -> 输出
# =========================
for ql, qh in tqdm(quantile_pairs, desc="分位数对总进度", bar_format=BARFMT):
    # ✅ 阈值建议用 OOF（更稳，不吃训练拟合）
    thr_low  = float(np.quantile(y_hat0_oof, ql))
    thr_high = float(np.quantile(y_hat0_oof, qh))

    title_suffix = f"(pred-quantiles={ql},{qh} -> thr={fmt3(thr_low)},{fmt3(thr_high)})"
    folder = DATA_DIR / f"results_STABLE_TESTSELECT_CBMETAGRID_{str(ql).replace('.','_')}_{str(qh).replace('.','_')}"
    os.makedirs(folder, exist_ok=True)

    # 1) test 选优（四重网格）
    df_sel = eval_by_test_r2(
        xgbb_values, cb_values, rf_values, cbm_values,
        xgbb_keys, cb_keys, rf_keys, cbm_keys,
        X_train_s_full, y_train,
        X_test_s, y_test,
        thr_low, thr_high,
        base_full_pred_train=y_hat0_full_train,
        base_full_pred_test=y_hat0_test,
        min_samples=MIN_SAMPLES,
        fold_indices=fold_indices,
        fold_id_for_es=0,
        xgb_es_rounds=50
    )
    df_sel.to_csv(os.path.join(folder, f"test_r2_selection_{ql}_{qh}.csv"), index=False)

    best_low  = pick_best(df_sel, "test_low_R2")
    best_mid  = pick_best(df_sel, "test_mid_R2")
    best_high = pick_best(df_sel, "test_high_R2")

    if best_low is None or best_mid is None or best_high is None:
        print(f"⚠️ 分位数({ql},{qh}) 选优失败（某段为空/全NaN），跳过")
        continue

    # 2) 三段分别重训（注意：每段“同一个函数”会把 train 再分 low/mid/high，但我们只用其对应段的 meta）
    pack_low  = train_full_and_build_meta(
        extract_xgb_base_params_row(best_low),
        extract_cb_params_row(best_low),
        extract_rf_params_row(best_low),
        extract_cb_meta_params_row(best_low),
        X_train_s_full, y_train, thr_low, thr_high,
        min_samples=MIN_SAMPLES,
        base_full_pred_train=y_hat0_full_train,
        fold_indices=fold_indices, fold_id_for_es=0, xgb_es_rounds=50
    )
    pack_mid  = train_full_and_build_meta(
        extract_xgb_base_params_row(best_mid),
        extract_cb_params_row(best_mid),
        extract_rf_params_row(best_mid),
        extract_cb_meta_params_row(best_mid),
        X_train_s_full, y_train, thr_low, thr_high,
        min_samples=MIN_SAMPLES,
        base_full_pred_train=y_hat0_full_train,
        fold_indices=fold_indices, fold_id_for_es=0, xgb_es_rounds=50
    )
    pack_high = train_full_and_build_meta(
        extract_xgb_base_params_row(best_high),
        extract_cb_params_row(best_high),
        extract_rf_params_row(best_high),
        extract_cb_meta_params_row(best_high),
        X_train_s_full, y_train, thr_low, thr_high,
        min_samples=MIN_SAMPLES,
        base_full_pred_train=y_hat0_full_train,
        fold_indices=fold_indices, fold_id_for_es=0, xgb_es_rounds=50
    )

    # 段内回退信息（权重只在 fallback 时有效）
    low_fb,  low_wx,  low_wc,  low_wr,  low_b  = extract_fallback_and_w(pack_low["meta"]["low"])
    mid_fb,  mid_wx,  mid_wc,  mid_wr,  mid_b  = extract_fallback_and_w(pack_mid["meta"]["mid"])
    high_fb, high_wx, high_wc, high_wr, high_b = extract_fallback_and_w(pack_high["meta"]["high"])

    # 3) 外部验证集评估
    mask_low_exp  = (y_hat0_exp <= thr_low)
    mask_mid_exp  = (y_hat0_exp >  thr_low) & (y_hat0_exp <= thr_high)
    mask_high_exp = (y_hat0_exp >  thr_high)

    X_low_exp_s  = X_exp_s[mask_low_exp];   y_low_exp  = y_exp[mask_low_exp].values
    X_mid_exp_s  = X_exp_s[mask_mid_exp];   y_mid_exp  = y_exp[mask_mid_exp].values
    X_high_exp_s = X_exp_s[mask_high_exp];  y_high_exp = y_exp[mask_high_exp].values

    y_low_exp_pred  = meta_predict_block(pack_low["xgb_base"],  pack_low["cb"],  pack_low["rf"],  X_low_exp_s,  pack_low["meta"]["low"])   if len(y_low_exp)>0  else np.array([])
    y_mid_exp_pred  = meta_predict_block(pack_mid["xgb_base"],  pack_mid["cb"],  pack_mid["rf"],  X_mid_exp_s,  pack_mid["meta"]["mid"])   if len(y_mid_exp)>0  else np.array([])
    y_high_exp_pred = meta_predict_block(pack_high["xgb_base"], pack_high["cb"], pack_high["rf"], X_high_exp_s, pack_high["meta"]["high"]) if len(y_high_exp)>0 else np.array([])

    exp_low   = compute_metrics(y_low_exp,  y_low_exp_pred)
    exp_mid   = compute_metrics(y_mid_exp,  y_mid_exp_pred)
    exp_high  = compute_metrics(y_high_exp, y_high_exp_pred)

    y_exp_all  = np.concatenate([a for a in [y_low_exp, y_mid_exp, y_high_exp] if len(a)>0])
    y_pred_all = np.concatenate([a for a in [y_low_exp_pred, y_mid_exp_pred, y_high_exp_pred] if len(a)>0])
    exp_all = compute_metrics(y_exp_all, y_pred_all)

    # 4) Train（用于画图）
    m_low  = pack_low["train_masks"]["low"]
    m_mid  = pack_low["train_masks"]["mid"]
    m_high = pack_low["train_masks"]["high"]

    y_low_tr  = y_train[m_low].values
    y_mid_tr  = y_train[m_mid].values
    y_high_tr = y_train[m_high].values

    y_low_tr_pred  = meta_predict_block(pack_low["xgb_base"],  pack_low["cb"],  pack_low["rf"],  X_train_s_full[m_low],  pack_low["meta"]["low"])
    y_mid_tr_pred  = meta_predict_block(pack_mid["xgb_base"],  pack_mid["cb"],  pack_mid["rf"],  X_train_s_full[m_mid],  pack_mid["meta"]["mid"])
    y_high_tr_pred = meta_predict_block(pack_high["xgb_base"], pack_high["cb"], pack_high["rf"], X_train_s_full[m_high], pack_high["meta"]["high"])

    y_train_all     = np.concatenate([a for a in [y_low_tr, y_mid_tr, y_high_tr] if len(a)>0])
    y_train_predall = np.concatenate([a for a in [y_low_tr_pred, y_mid_tr_pred, y_high_tr_pred] if len(a)>0])
    tr_all = compute_metrics(y_train_all, y_train_predall)

    # 5) Test 评估（并用于画图）
    mask_low_test  = (y_hat0_test <= thr_low)
    mask_mid_test  = (y_hat0_test >  thr_low) & (y_hat0_test <= thr_high)
    mask_high_test = (y_hat0_test >  thr_high)

    X_low_test_s  = X_test_s[mask_low_test];   y_low_test  = y_test[mask_low_test].values
    X_mid_test_s  = X_test_s[mask_mid_test];   y_mid_test  = y_test[mask_mid_test].values
    X_high_test_s = X_test_s[mask_high_test];  y_high_test = y_test[mask_high_test].values

    y_low_test_pred  = meta_predict_block(pack_low["xgb_base"],  pack_low["cb"],  pack_low["rf"],  X_low_test_s,  pack_low["meta"]["low"])   if len(y_low_test)>0  else np.array([])
    y_mid_test_pred  = meta_predict_block(pack_mid["xgb_base"],  pack_mid["cb"],  pack_mid["rf"],  X_mid_test_s,  pack_mid["meta"]["mid"])   if len(y_mid_test)>0  else np.array([])
    y_high_test_pred = meta_predict_block(pack_high["xgb_base"], pack_high["cb"], pack_high["rf"], X_high_test_s, pack_high["meta"]["high"]) if len(y_high_test)>0 else np.array([])

    y_test_all     = np.concatenate([a for a in [y_low_test, y_mid_test, y_high_test] if len(a)>0])
    y_test_predall = np.concatenate([a for a in [y_low_test_pred, y_mid_test_pred, y_high_test_pred] if len(a)>0])
    te_all = compute_metrics(y_test_all, y_test_predall)

    # 6) 汇总 CSV（含三段超参 + fallback 权重 + train/test/exp 指标）
    summary_row = {
        "quantiles_low": ql, "quantiles_high": qh, "thr_low": thr_low, "thr_high": thr_high,

        **{f"low_BASEXGB_{k}":  best_low[f"BASEXGB_{k}"]  for k in xgbb_keys},
        **{f"low_CB_{k}":       best_low[f"CB_{k}"]       for k in cb_keys},
        **{f"low_RF_{k}":       best_low[f"RF_{k}"]       for k in rf_keys},
        **{f"low_METACB_{k}":   best_low[f"METACB_{k}"]   for k in cbm_keys},

        **{f"mid_BASEXGB_{k}":  best_mid[f"BASEXGB_{k}"]  for k in xgbb_keys},
        **{f"mid_CB_{k}":       best_mid[f"CB_{k}"]       for k in cb_keys},
        **{f"mid_RF_{k}":       best_mid[f"RF_{k}"]       for k in rf_keys},
        **{f"mid_METACB_{k}":   best_mid[f"METACB_{k}"]   for k in cbm_keys},

        **{f"high_BASEXGB_{k}": best_high[f"BASEXGB_{k}"] for k in xgbb_keys},
        **{f"high_CB_{k}":      best_high[f"CB_{k}"]      for k in cb_keys},
        **{f"high_RF_{k}":      best_high[f"RF_{k}"]      for k in rf_keys},
        **{f"high_METACB_{k}":  best_high[f"METACB_{k}"]  for k in cbm_keys},

        "low_meta_fallback":  low_fb,  "low_w_xgbb":  low_wx,  "low_w_cb":  low_wc,  "low_w_rf":  low_wr,  "low_b":  low_b,
        "mid_meta_fallback":  mid_fb,  "mid_w_xgbb":  mid_wx,  "mid_w_cb":  mid_wc,  "mid_w_rf":  mid_wr,  "mid_b":  mid_b,
        "high_meta_fallback": high_fb, "high_w_xgbb": high_wx, "high_w_cb": high_wc, "high_w_rf": high_wr, "high_b": high_b,

        "train_R2": tr_all[0], "train_MAE": tr_all[1], "train_RMSE": tr_all[2], "train_NRMSE": tr_all[3],

        "test_low_R2":  safe_r2(y_low_test,  y_low_test_pred),
        "test_mid_R2":  safe_r2(y_mid_test,  y_mid_test_pred),
        "test_high_R2": safe_r2(y_high_test, y_high_test_pred),
        "test_all_R2":  te_all[0],
        "test_all_MAE": te_all[1],
        "test_all_RMSE":te_all[2],
        "test_all_NRMSE":te_all[3],

        "exp_low_R2":  exp_low[0],  "exp_mid_R2":  exp_mid[0],  "exp_high_R2": exp_high[0], "exp_all_R2": exp_all[0],
        "exp_all_MAE": exp_all[1],  "exp_all_RMSE": exp_all[2], "exp_all_NRMSE": exp_all[3],
    }

    pd.DataFrame([summary_row]).to_csv(
        os.path.join(folder, f"final_eval_STABLE_{ql}_{qh}.csv"),
        index=False
    )

    # 7) 两张散点图
    plot_train_and_exp(
        folder, title_suffix,
        y_low_tr, y_mid_tr, y_high_tr,
        y_low_tr_pred, y_mid_tr_pred, y_high_tr_pred,
        y_low_exp, y_mid_exp, y_high_exp,
        y_low_exp_pred, y_mid_exp_pred, y_high_exp_pred,
        tr_all, exp_all
    )
    plot_train_and_test(
        folder, title_suffix,
        y_low_tr, y_mid_tr, y_high_tr,
        y_low_tr_pred, y_mid_tr_pred, y_high_tr_pred,
        y_low_test, y_mid_test, y_high_test,
        y_low_test_pred, y_mid_test_pred, y_high_test_pred
    )

    print(f"✅ 完成 {title_suffix} | Test(all)R2={fmt3(te_all[0])} | Exp(all)R2={fmt3(exp_all[0])} | 输出目录：{folder}")

print("🎉 全部分位数组合处理完成。")
