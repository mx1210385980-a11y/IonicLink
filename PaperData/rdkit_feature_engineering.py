import os
import pandas as pd
from rdkit import Chem
from rdkit.Chem import Descriptors

# =====================================================================
# 1. 离子液体超级字典 (Mega Dictionary for Ionic Liquids)
# =====================================================================
IL_SMILES_DICT = {
    # === 咪唑类 (Imidazolium-based) ===
    # 1. EMIM (1-Ethyl-3-methylimidazolium) 系列
    "[emim][bf4]": "CCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "[emim][pf6]": "CCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[emim][tfsi]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[emim][ntf2]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", 
    "[emim][fsi]": "CCN1C=C[N+](=C1)C.O=S(=O)(F)[N-]S(=O)(=O)F",
    "[emim][dca]": "CCN1C=C[N+](=C1)C.N#C[N-]C#N",
    "[emim][tfo]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[O-]",
    "[emim][otf]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[O-]", 
    "[emim][cl]": "CCN1C=C[N+](=C1)C.[Cl-]",
    "[emim][br]": "CCN1C=C[N+](=C1)C.[Br-]",
    "[emim][oac]": "CCN1C=C[N+](=C1)C.CC(=O)[O-]",

    # 2. BMIM (1-Butyl-3-methylimidazolium) 系列
    "[bmim][bf4]": "CCCCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "bmimbf4": "CCCCN1C=C[N+](=C1)C.F[B-](F)(F)F", 
    "[bmim][pf6]": "CCCCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[bmim][tfsi]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmim][ntf2]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmim][tf2n]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # TF2N 是 NTf2/TFSI 的别名
    "[bmim][fsi]": "CCCCN1C=C[N+](=C1)C.O=S(=O)(F)[N-]S(=O)(=O)F",
    "[bmim][dca]": "CCCCN1C=C[N+](=C1)C.N#C[N-]C#N",
    "[bmim][tfo]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[O-]",
    "[bmim][otf]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[O-]",
    "[bmim][cl]": "CCCCN1C=C[N+](=C1)C.[Cl-]",
    "[bmim][br]": "CCCCN1C=C[N+](=C1)C.[Br-]",
    "[bmim][oac]": "CCCCN1C=C[N+](=C1)C.CC(=O)[O-]",
    "[bmim][tcm]": "CCCCN1C=C[N+](=C1)C.N#C[C-](C#N)C#N", 
    "[bmim][scn]": "CCCCN1C=C[N+](=C1)C.N#C[S-]", # 硫氰酸盐 (Thiocyanate)

    # 3. HMIM (1-Hexyl-3-methylimidazolium) 系列
    "[hmim][bf4]": "CCCCCCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "[hmim][pf6]": "CCCCCCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[hmim][tfsi]": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[hmim][ntf2]": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[hmim][cl]": "CCCCCCN1C=C[N+](=C1)C.[Cl-]",

    # 4. OMIM (1-Octyl-3-methylimidazolium) 系列
    "[omim][bf4]": "CCCCCCCCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "[omim][pf6]": "CCCCCCCCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[omim][tfsi]": "CCCCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[omim][ntf2]": "CCCCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[omim][cl]": "CCCCCCCCN1C=C[N+](=C1)C.[Cl-]",

    # === 吡啶类 (Pyridinium-based) ===
    "[bupy][bf4]": "CCCC[n+]1ccccc1.F[B-](F)(F)F",
    "[bupy][pf6]": "CCCC[n+]1ccccc1.F[P-](F)(F)(F)(F)F",
    "[bupy][tfsi]": "CCCC[n+]1ccccc1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bupy][ntf2]": "CCCC[n+]1ccccc1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",

    # === 吡咯烷类 (Pyrrolidinium-based) ===
    "[pmpyr][tfsi]": "CCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[pmpyr][ntf2]": "CCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmpyr][tfsi]": "CCCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmpyr][ntf2]": "CCCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",

    # === 季铵类 (Ammonium-based) ===
    "[n1114][tfsi]": "CCCC[N+](C)(C)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",

    # === 混合物与小分子硝酸盐 (Mixtures & Special) ===
    "ean": "CC[NH3+].[O-][N+](=O)[O-]", # Ethylammonium nitrate (硝酸乙基铵)
    "ean + lino3 0.1 m": "CC[NH3+].[O-][N+](=O)[O-].[Li+].[O-][N+](=O)[O-]", # 混合物组合
    "[keggin][emim]3": "CCN1C=C[N+](=C1)C.CCN1C=C[N+](=C1)C.CCN1C=C[N+](=C1)C", # Keggin 难以被普通有机算子处理，仅使用提取阳离子代偿

    # === 聚合物离子液体 (Polymerized ILs - 侧链代理模型) ===
    # 备注：由于高分子无法计算分子量，这里采用它的侧链重复单元（如烷基鏻结构）作为代理特征输入
    "[mpil_ethyl][bf4]": "CCCC[P+](CCCC)(CCCC)CC.F[B-](F)(F)F",
    "[mpil_butyl][bf4]": "CCCC[P+](CCCC)(CCCC)CCCC.F[B-](F)(F)F",
    "[mpil_octyl][bf4]": "CCCCCCCC[P+](CCCC)(CCCC)CCCC.F[B-](F)(F)F",

    # === 用户新增批量离子液体 (Batch Update) ===
    "[pyr14][tfsi]": "CCCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[hmim][tf2n]": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "chcl-eg": "C[N+](C)(C)CCO.[Cl-].OCCO", # 氯化胆碱-乙二醇 低共熔溶剂 (DES)
    "[c4mim+][tf2n-]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c2mim][ntf2]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c2mim][123triaz]": "CCN1C=C[N+](=C1)C.c1c[n-]nn1", # 1,2,3-triazolide 阴离子
    "[c2mim][tfsi]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[p222mom][tfsi]": "CC[P+](CC)(CC)COC.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c4mim][no3]": "CCCCN1C=C[N+](=C1)C.[O-][N+](=O)[O-]",
    "[p4,4,4,8][bscb]": "CCCCCCCC[P+](CCCC)(CCCC)CCCC.O=C1O[B-]2(OC(=O)c3ccccc3O2)Oc4ccccc41", # 双水杨酸硼酸盐
    "[hmim][br]": "CCCCCCN1C=C[N+](=C1)C.[Br-]",
    "[c2c1im][tf2n]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # C2C1im 即 EMIM
    "[c6c1im][tf2n]": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # C6C1im 即 HMIM
    "[n4111][tfsi]": "CCCC[N+](C)(C)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[pyr13][tfsi]": "CCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c4mim][tf2n]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bupy][tf2n]": "CCCC[n+]1ccccc1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c6c1im][cl]": "CCCCCCN1C=C[N+](=C1)C.[Cl-]",
    "[c8c1im][cl]": "CCCCCCCCN1C=C[N+](=C1)C.[Cl-]", # C8C1im 即 OMIM
    "[c10c1im][cl]": "CCCCCCCCCCN1C=C[N+](=C1)C.[Cl-]",
    "[c4c1im][pf6]": "CCCCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F", # C4C1im 即 BMIM
    "[c6c1im][pf6]": "CCCCCCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[c8c1im][pf6]": "CCCCCCCCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[c10c1im][pf6]": "CCCCCCCCCCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[c2c1im][cl]": "CCN1C=C[N+](=C1)C.[Cl-]",
    "[c4c1im][cl]": "CCCCN1C=C[N+](=C1)C.[Cl-]",
    "[c2c1im][pf6]": "CCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[bmim][litfsi]": "CCCCN1C=C[N+](=C1)C.[Li+].FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # 混合体系
    "[bmim+][tf2n-]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "dic9-il": "CN1C=C[N+](=C1)CCCCCCCCCN2C=C[N+](=C2)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # 假设阴离子为TFSI的双子离子液体
    "[heim][tfsi]": "OCCn1cc[n+](C)c1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # 1-(2-羟乙基)-3-甲基咪唑

    # 1. 经典咪唑类 (包含各种奇葩缩写和别名)
    "[bmim]bf4": "CCCCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "bmimtfsi": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c4mim][ntf2]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "c2c1imtf2n": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "c6c1imtf2n": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c6c1imtfsi]": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "omimbf4": "CCCCCCCCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "[omim+][tfsi-]": "CCCCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[emim][no3]": "CCN1C=C[N+](=C1)C.[O-][N+](=O)[O-]",
    "[emim][etso4]": "CCN1C=C[N+](=C1)C.CCOS(=O)(=O)[O-]", # 乙基硫酸盐
    "emim-bf4": "CCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "hmimbr": "CCCCCCN1C=C[N+](=C1)C.[Br-]",
    "bmimbr": "CCCCN1C=C[N+](=C1)C.[Br-]",
    
    # 2. 特殊结构咪唑类
    "bmmimtfsi": "CCCCN1C=C[N+](C)=C1C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # 1-丁基-2,3-二甲基咪唑
    "[hc8im][tfsi]": "CCCCCCCCn1cc[nH+]c1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # 1-辛基咪唑鎓 (带质子)
    "[hc8im][tfsi] with imidazole": "CCCCCCCCn1cc[nH+]c1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.c1c[nH]cn1", # 掺杂中性咪唑

    # 3. 季铵盐类与吡咯烷类
    "[me3bun+][tf2n-]": "CCCC[N+](C)(C)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "pyr14tfsi": "CCCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "dema-oms": "CC[NH+](C)CC.CS(=O)(=O)[O-]", # 二乙基甲基铵 甲烷磺酸盐
    "pan": "CCC[NH3+].[O-][N+](=O)[O-]", # 丙铵硝酸盐 (Propylammonium nitrate)

    # 4. 庞大且复杂的季鏻盐类与杂环
    "[c8isoq+][tf2n-]": "CCCCCCCC[n+]1ccc2ccccc2c1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # 辛基异喹啉鎓
    "[p4,4,4,4][meea]": "CCCC[P+](CCCC)(CCCC)CCCC.COCCOCCOCC(=O)[O-]", # 四丁基鏻 [2-(2-甲氧基乙氧基)乙氧基]乙酸盐
    "[p6,6,6,14][bscb]": "CCCCCCCCCCCCCC[P+](CCCCCC)(CCCCCC)CCCCCC.O=C1O[B-]2(OC(=O)c3ccccc3O2)Oc4ccccc41", # 三己基十四烷基鏻 双水杨酸硼酸盐

    # 5. 深共晶溶剂 (DES) 与特殊分子
    "water": "O",
    "chcl-eg des": "C[N+](C)(C)CCO.[Cl-].OCCO", # 氯化胆碱-乙二醇
    "des6": "C[N+](C)(C)CCO.[Cl-].NC(=O)N.NC(=O)N", # 常规DES6代指 Reline (氯化胆碱:尿素 1:2)
    "[alcl2(urea)2]+/alcl4-": "NC(=O)N.Cl[Al](Cl)Cl", # 铝基络合物DES (使用 Urea-AlCl3 体系代偿)

    # 6. 聚合物基底代偿 (侧链)
    "mpil_ethyl": "CCCC[P+](CCCC)(CCCC)CC",
    "mpil_butyl": "CCCC[P+](CCCC)(CCCC)CCCC",
    "mpil_octyl": "CCCCCCCC[P+](CCCC)(CCCC)CCCC",
    "[emim]3[keggin]": "CCN1C=C[N+](=C1)C.CCN1C=C[N+](=C1)C.CCN1C=C[N+](=C1)C",

    # 7. 掺杂体系与混合物 (电池电解液常用)
    "bmim li tfsi": "CCCCN1C=C[N+](=C1)C.[Li+].FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "bmimlitfsi": "CCCCN1C=C[N+](=C1)C.[Li+].FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "bmim-li": "CCCCN1C=C[N+](=C1)C.[Li+]", # 假定默认阴离子缺失，仅代偿BMIM和Li
    "omim-li": "CCCCCCCCN1C=C[N+](=C1)C.[Li+]", 
    "[bmim]bf4/litf": "CCCCN1C=C[N+](=C1)C.F[B-](F)(F)F.[Li+].FC(F)(F)S(=O)(=O)[O-]", # 掺杂三氟甲磺酸锂
    "pyr13+tfsi- (with 0.5 m li+tfsi-)": "CCC[N+]1(C)CCCC1.[Li+].FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[p4,4,4,4][meea] with limeea": "CCCC[P+](CCCC)(CCCC)CCCC.[Li+].COCCOCCOCC(=O)[O-].COCCOCCOCC(=O)[O-]",
    "ean + lino3": "CC[NH3+].[O-][N+](=O)[O-].[Li+].[O-][N+](=O)[O-]", # 硝酸乙基铵 掺杂 硝酸锂

        # === 咪唑类 (Imidazolium-based) ===
    # 1. EMIM (1-Ethyl-3-methylimidazolium) 系列
    "[emim][bf4]": "CCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "emimbf4": "CCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "emim-bf4": "CCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "emim+-bf4-": "CCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "[emi][bf4]": "CCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "[emim][pf6]": "CCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[emim][tfsi]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "emimtfsi": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "emitfsi": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[emim][tf2n]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", 
    "emimtf2n": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "emim tf2n": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "emim+ tfsi-": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[emim+][tf2n-]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "emim-fsi": "CCN1C=C[N+](=C1)C.O=S(=O)(F)[N-]S(=O)(=O)F",
    "[emim][fsi]": "CCN1C=C[N+](=C1)C.O=S(=O)(F)[N-]S(=O)(=O)F",
    "[emim][dca]": "CCN1C=C[N+](=C1)C.N#C[N-]C#N",
    "[emim][tfo]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[O-]",
    "[emim][otf]": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[O-]", 
    "[emim][cl]": "CCN1C=C[N+](=C1)C.[Cl-]",
    "[emim][br]": "CCN1C=C[N+](=C1)C.[Br-]",
    "[emim][ac]": "CCN1C=C[N+](=C1)C.CC(=O)[O-]",
    "emimac": "CCN1C=C[N+](=C1)C.CC(=O)[O-]",
    "[emim][etso4]": "CCN1C=C[N+](=C1)C.CCOS(=O)(=O)[O-]",
    "[emim][no3]": "CCN1C=C[N+](=C1)C.[O-][N+](=O)[O-]",

    # 2. BMIM (1-Butyl-3-methylimidazolium) 系列
    "[bmim][bf4]": "CCCCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "bmimbf4": "CCCCN1C=C[N+](=C1)C.F[B-](F)(F)F", 
    "bmim bf4": "CCCCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "bmim+bf4-": "CCCCN1C=C[N+](=C1)C.F[B-](F)(F)F",
    "[bmim][pf6]": "CCCCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[bmi][pf6]": "CCCCN1C=C[N+](=C1)C.F[P-](F)(F)(F)(F)F",
    "[bmim] tfsi": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmim][tfsi]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmi][tfsi]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "bmim-tfsi": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "bmimtfsi": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmim][ntf2]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmim][tf2n]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "bmim tf2n": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c4mim][ntf2]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "c4mimtfsi": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmim][fsi]": "CCCCN1C=C[N+](=C1)C.O=S(=O)(F)[N-]S(=O)(=O)F",
    "bmimdca": "CCCCN1C=C[N+](=C1)C.N#C[N-]C#N",
    "[bmim][tfo]": "CCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[O-]",
    "[bmim][cl]": "CCCCN1C=C[N+](=C1)C.[Cl-]",
    "[bmim][br]": "CCCCN1C=C[N+](=C1)C.[Br-]",
    "bmimbr": "CCCCN1C=C[N+](=C1)C.[Br-]",
    "[bmim][i]": "CCCCN1C=C[N+](=C1)C.[I-]",
    "[bmim][ac]": "CCCCN1C=C[N+](=C1)C.CC(=O)[O-]",
    "bmim-ocso4": "CCCCN1C=C[N+](=C1)C.CCCCCCCCOS(=O)(=O)[O-]", # BMIM Octylsulfate
    "[bmim][tcm]": "CCCCN1C=C[N+](=C1)C.N#C[C-](C#N)C#N", 
    "[bmim][scn]": "CCCCN1C=C[N+](=C1)C.N#C[S-]",
    "bmim-bh3": "CCCCN1C=C[N+](=C1)C.[BH4-]", # 硼氢化物替代BH3进行计算
    "bmim+": "CCCCN1C=C[N+](=C1)C",

    # 3. HMIM (1-Hexyl-3-methylimidazolium) 系列
    "[hmim][tfsi]": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "hmim-tfsi": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "c6c1imtfsi": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "c6mimtfsi": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c6mim][ntf2]": "CCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c6mim][cl]": "CCCCCCN1C=C[N+](=C1)C.[Cl-]",

    # 4. OMIM (1-Octyl-3-methylimidazolium) 系列
    "[omim][tfsi]": "CCCCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c8mim][ntf2]": "CCCCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c8mim][cl]": "CCCCCCCCN1C=C[N+](=C1)C.[Cl-]",
    "[omim][ac]": "CCCCCCCCN1C=C[N+](=C1)C.CC(=O)[O-]",
    "[omim+][tcm-]": "CCCCCCCCN1C=C[N+](=C1)C.N#C[C-](C#N)C#N",

    # 5. 其他特殊链长咪唑与修饰咪唑 (Special Imidazolium)
    "[pmim][ntf2]": "CCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[meprimi][i]": "CCCN1C=C[N+](=C1)C.[I-]", # 1-methyl-3-propylimidazolium iodide
    "[c10mim][ntf2]": "CCCCCCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[c12mim][tf2n]": "CCCCCCCCCCCCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[dmim+][cl-]": "CN1C=C[N+](=C1)C.[Cl-]", # 1,3-Dimethylimidazolium
    "[dmim][cl]": "CN1C=C[N+](=C1)C.[Cl-]",
    "[mmim][br]": "CN1C=C[N+](=C1)C.[Br-]", # 1,3-Dimethylimidazolium bromide
    "[bmih][tf2n]": "CCCCn1cc[nH+]c1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # 1-butylimidazolium (质子化)
    "vips (1-vinyl-3-(3-sulfopropyl)-imidazolium methanesulfonate)": "C=Cn1cc[n+](CCCS(=O)(=O)O)c1.CS(=O)(=O)[O-]", # 乙烯基磺酸功能化
    "[bvim][pf6]": "CCCCN1C=C[N+](=C1)C=C.F[P-](F)(F)(F)(F)F", # 1-Butyl-3-vinylimidazolium
    "[h2nc(dma)2][beti]": "CN(C)C(=[NH2+])N(C)C.FC(F)(F)C(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)C(F)(F)F", # 胍盐配合双全氟乙基磺酰亚胺

    # === 吡咯烷类 (Pyrrolidinium-based) ===
    "[pyr13][tfsi]": "CCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "pyr13 [tfsi]": "CCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[pyr13][tf2n]": "CCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "c2mimtfsi": "CCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # 文献常混淆，统一解析
    "[pyr16][tf2n]": "CCCCCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmpy][tf2n]": "CCCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # 1-butyl-1-methylpyrrolidinium

    # === 季铵类 (Ammonium-based) ===
    "tmpa+cl-": "CCC[N+](C)(C)C.[Cl-]", # Trimethylpropylammonium
    "tmpa+": "CCC[N+](C)(C)C",
    "dta+cl-": "CCCCCCCCCCCC[N+](C)(C)C.[Cl-]", # Dodecyltrimethylammonium
    "dta+": "CCCCCCCCCCCC[N+](C)(C)C",
    "[dema][tfo]": "CC[NH+](C)CC.FC(F)(F)S(=O)(=O)[O-]", # Diethylmethylammonium triflate
    "compound 1 (ammonium-based cation with bf4 anion)": "[NH4+].F[B-](F)(F)F", # 泛指通用铵盐替代

    # === 特殊深共晶/添加剂溶剂 (DES & Solvents) ===
    "[ch][chc]": "C[N+](C)(C)CCO.O=C(O)CC(O)(CC(=O)[O-])C(=O)O", # 假定为 Choline Dihydrogen Citrate (胆碱柠檬酸盐)
    "[ch][cpc]": "CCCCCCCCCCCCCCCC[n+]1ccccc1.[Cl-]", # 提取为常见CPC Cetylpyridinium Chloride
    
    # === 极其复杂的混合体系 (Mixtures with Lithium & Solvents) ===
    "0.5 m li-pyr1.3-tfsi": "[Li+].CCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "pyr13tfsi with 0.5m litfsi": "[Li+].CCC[N+]1(C)CCCC1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[0.2mli+][emi+][tfsa-]": "[Li+].CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[1mli+][emi+][tfsa-]": "[Li+].CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "[bmim] tfsi with litfsi": "CCCCN1C=C[N+](=C1)C.[Li+].FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F",
    "emitfsi/pc": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.CC1COC(=O)O1", # 添加 PC 溶剂 (碳酸丙烯酯)
    "emimtfsi:emimbf4 (8:2)": "CCN1C=C[N+](=C1)C.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F.F[B-](F)(F)F", # TFSI与BF4混合阴离子
    "il-1 (1-methyl-3-propyl-imidazolium iodide and 1-ethyl-3-methyl-imidazolium tricyanomethanide mixture)": "CCCN1C=C[N+](=C1)C.[I-].CCN1C=C[N+](=C1)C.N#C[C-](C#N)C#N",
    "im/hc8imtfsi mixture": "c1c[nH]cn1.CCCCCCCCn1cc[nH+]c1.FC(F)(F)S(=O)(=O)[N-]S(=O)(=O)C(F)(F)F", # 中性咪唑掺杂体系
}

# =====================================================================
# 2. 核心计算引擎 (完全本地化 & 强化防御)
# =====================================================================
def get_rdkit_features_dict(il_abbr):
    """从本地字典查找并计算特征，现已包含 SMILES 的输出"""
    # 🚨 新增了 SMILES 列的空值模板
    empty_features = {
        "SMILES": None, 
        "Mol_Weight (g/mol)": None, 
        "LogP (Hydrophobicity)": None,
        "TPSA (Polar Surface Area)": None, 
        "Num_H_Donors": None, 
        "Num_H_Acceptors": None
    }
    
    if pd.isna(il_abbr) or il_abbr is None:
        return empty_features
        
    cleaned_abbr = str(il_abbr).lower().strip()
    
    if not cleaned_abbr or cleaned_abbr == 'nan':
        return empty_features

    # 只查本地字典
    smiles = IL_SMILES_DICT.get(cleaned_abbr, None)
    
    if not smiles or not isinstance(smiles, str):
        return empty_features
            
    try:
        mol = Chem.MolFromSmiles(smiles)
    except Exception as e:
        print(f"  ⚠️ RDKit 无法解析 SMILES '{smiles}': {e}")
        return empty_features
        
    if not mol:
        return empty_features

    # 💡 核心更新：返回的特征库中加入了原始 SMILES 字符串
    return {
        "SMILES": smiles,
        "Mol_Weight (g/mol)": round(Descriptors.MolWt(mol), 2),
        "LogP (Hydrophobicity)": round(Descriptors.MolLogP(mol), 2),
        "TPSA (Polar Surface Area)": round(Descriptors.TPSA(mol), 2),
        "Num_H_Donors": Descriptors.NumHDonors(mol),
        "Num_H_Acceptors": Descriptors.NumHAcceptors(mol)
    }

def calculate_rdkit_descriptors(il_name):
    """兼容老版本 Pandas apply 调用的包装函数"""
    return pd.Series(get_rdkit_features_dict(il_name))

# =====================================================================
# 3. 为未来大模型批量提取预留的接口
# =====================================================================
def process_extracted_records(records):
    print("\n🧪 正在调用本地 RDKit 字典进行特征扩充 (包含 SMILES 结构式)...")
    missing_ils = set()
    
    for record in records:
        il_abbr = record.get('ionic_liquid', '')
        if il_abbr:
            rdkit_features = get_rdkit_features_dict(il_abbr)
            record.update(rdkit_features)
            
            if rdkit_features["Mol_Weight (g/mol)"] is None:
                missing_ils.add(il_abbr)
                
    if missing_ils:
        print("\n  ⚠️ 警告: 以下离子液体不在超级字典中，或其 SMILES 表达式存在化学错误无法被解析：")
        for il in missing_ils:
            print(f"    - {il}")
        print("  💡 解决方案: 请检查字典中该物质的 SMILES 是否正确。")
    else:
        print("  ✅ 所有离子液体的分子特征已完美融合！")
        
    return records

# =====================================================================
# 4. 修复已有历史表格的核心功能
# =====================================================================
def add_molecular_features_to_excel(input_excel, output_excel):
    print(f"📄 正在读取你的历史数据集: {input_excel}")
    try:
        if input_excel.endswith('.csv'):
            df = pd.read_csv(input_excel)
        else:
            df = pd.read_excel(input_excel)
    except Exception as e:
        print(f"❌ 读取文件失败: {e}")
        return

    if 'ionic_liquid' not in df.columns:
        print("❌ 表格中找不到 'ionic_liquid' 列！请检查表头。")
        return

    print("🧪 正在比对超级字典并计算 RDKit 特征 (包含 SMILES)...")
    
    # 丢掉原表中可能已经存在的空壳特征列（防止列名重复冲突），新增了 "SMILES" 的丢弃重算
    cols_to_drop = ["SMILES", "Mol_Weight (g/mol)", "LogP (Hydrophobicity)", "TPSA (Polar Surface Area)", "Num_H_Donors", "Num_H_Acceptors"]
    df = df.drop(columns=[col for col in cols_to_drop if col in df.columns])

    # 重新计算并拼接
    new_features_df = df['ionic_liquid'].apply(calculate_rdkit_descriptors)
    final_df = pd.concat([df, new_features_df], axis=1)
    
    # 检查哪些没算出来
    missing_ils = final_df[final_df['Mol_Weight (g/mol)'].isna()]['ionic_liquid'].dropna().unique()
    
    final_df.to_excel(output_excel, index=False)
    print(f"✅ 历史数据补全完成！已生成包含完整特征的新表格: {output_excel}")
    
    if len(missing_ils) > 0:
        print("\n⚠️ 你的表格里有极个别物质不在超级字典中，或其化学表达式 RDKit 拒绝解析：")
        for il in missing_ils:
            print(f"  - {il}")
        print("💡 请将它们手动添加到字典里（或检查其化学价态），然后再运行一次本脚本即可修复！")

if __name__ == "__main__":
    # 👇 关键：这里填入你已经提取好的那个 CSV 文件的名字
    input_file = "Extraction_Results.xlsx" 
    output_file = "ML_Ready_Dataset.xlsx"
    
    if os.path.exists(input_file):
        add_molecular_features_to_excel(input_file, output_file)
    else:
        print(f"找不到文件：{input_file}。请确保名字没写错并且放在同一个文件夹下。")