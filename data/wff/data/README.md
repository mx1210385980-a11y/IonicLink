# ML-WFF 文件说明

这个目录用于保存薄膜/离子液体摩擦系数预测相关的数据和建模脚本。

## 文件清单

| 文件名 | 原文件名 | 含义 | 用途 |
| --- | --- | --- | --- |
| `train.csv` | `film train data end 0106.csv` | 训练集，169 条样本，包含基础特征、目标列 `μ`，以及 `friction_bin`、`cation_bin`、`stratify_label` 分层辅助列。 | 用于训练 Gate 模型、基础模型和段内融合模型。 |
| `test.csv` | `film test data end 0106.csv` | 测试集，37 条样本，包含目标列 `μ`、分层辅助列，以及旧流程留下的 `friction_pred`、`friction_diff`、`error_flag` 等误差检查列。 | 用于选择 low/mid/high 三段的最佳超参数组合，并评估测试集表现。 |
| `literature.csv` | `film 6 pre-literature data end 0106.csv` | 文献来源外部验证集，6 条样本，字段与建模特征一致，目标列为 `μ`。 | 脚本默认把它作为外部验证集，输出 `exp_*` 指标和 train/literature 散点图。 |
| `experiment.csv` | `end film experiment data end 0106.csv` | 实验来源外部数据集，10 条样本，字段与建模特征一致，目标列为 `μ`。 | 备用外部验证集；如需用它验证，在 `stacked_friction_model.py` 中把 `exp_path` 改为 `DATA_DIR / "experiment.csv"`。 |
| `stacked_friction_model.py` | `film Cat&RF&XGb -Cat 1224.py` | 分段集成建模脚本：CatBoost Gate 分段，XGBoost/CatBoost/RandomForest 段内专家，CatBoost Meta 融合。 | 读取 `train.csv`、`test.csv`、`literature.csv`，输出参数筛选结果、最终指标 CSV 和散点图。 |

## 关键字段

- `μ`：预测目标，摩擦系数。
- `Cation`、`anion`、`compound`、`surface`：样本标识和实验条件。
- `h` 到 `BalJ_an`：脚本使用的数值特征列，当前脚本取 `train.csv` 的第 5 到第 30 列作为特征。
- `friction_bin`、`cation_bin`、`stratify_label`：训练/测试划分时的辅助分层标签，不作为模型输入。
- `friction_pred`、`friction_diff`、`error_flag`：`test.csv` 中旧流程生成的预测误差记录，不作为当前脚本输入。

## 运行说明

在当前目录安装好依赖后运行：

```bash
python stacked_friction_model.py
```

主要依赖：

- `numpy`
- `pandas`
- `matplotlib`
- `scikit-learn`
- `catboost`
- `xgboost`
- `tqdm`

输出目录命名格式为 `results_STABLE_TESTSELECT_CBMETAGRID_<low_quantile>_<high_quantile>`。
