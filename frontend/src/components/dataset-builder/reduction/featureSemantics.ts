import type { SubsetKey } from '../types'

export type ColumnSemantic = {
  title: string
  meaning: string
  explanation: string
  unit: string
  modelHint: string
}

export type SensitivityItem = {
  feature: string
  correlation: number
  abs_correlation: number
}

export const FEATURE_ALIASES: Record<string, string[]> = {
  MW_cat: ['Cation_MolWt'],
  logP_cat: ['Cation_MolLogP'],
  N_rot_cat: ['Cation_NumRotatableBonds'],
  Bertz_cat: ['Cation_BertzCT'],
  BalJ_cat: ['Cation_BalabanJ'],
  TPSA_cat: ['Cation_TPSA'],
  N_HA_cat: ['Cation_NumHAcceptors'],
  N_HD_cat: ['Cation_NumHDonors'],
  MW_an: ['Anion_MolWt'],
  logP_an: ['Anion_MolLogP'],
  Bertz_an: ['Anion_BertzCT'],
  TPSA_an: ['Anion_TPSA'],
  BalJ_an: ['Anion_BalabanJ'],
  theta_s: ['θ_s'],
  Rq: ['Surface_Roughness'],
  velocity: ['Speed'],
  T: ['Temperature'],
  I_H2O: ['Water_Content'],
  h: ['Film_Thickness'],
  Cation_MolWt: ['MW_cat'],
  Cation_MolLogP: ['logP_cat'],
  Cation_NumRotatableBonds: ['N_rot_cat'],
  Cation_BertzCT: ['Bertz_cat'],
  Cation_BalabanJ: ['BalJ_cat'],
  Cation_TPSA: ['TPSA_cat'],
  Cation_NumHAcceptors: ['N_HA_cat'],
  Cation_NumHDonors: ['N_HD_cat'],
  Anion_MolWt: ['MW_an'],
  Anion_MolLogP: ['logP_an'],
  Anion_BertzCT: ['Bertz_an'],
  Anion_TPSA: ['TPSA_an'],
  Anion_BalabanJ: ['BalJ_an'],
  θ_s: ['theta_s'],
  Surface_Roughness: ['Rq'],
  Speed: ['velocity'],
  Temperature: ['T'],
  Water_Content: ['I_H2O'],
  Film_Thickness: ['h'],
}

export const FALLBACK_SENSITIVITY_MAP: Record<SubsetKey, SensitivityItem[]> = {
  dataset_a: [
    { feature: 'N_HD_cat', correlation: 0.4996, abs_correlation: 0.4996 },
    { feature: 'TPSA_cat', correlation: 0.4401, abs_correlation: 0.4401 },
    { feature: 'theta_s', correlation: -0.2722, abs_correlation: 0.2722 },
    { feature: 'Bertz_an', correlation: -0.2641, abs_correlation: 0.2641 },
    { feature: 'I_H2O', correlation: 0.237, abs_correlation: 0.237 },
  ],
  dataset_b: [
    { feature: 'N_qN_cat', correlation: 0.4335, abs_correlation: 0.4335 },
    { feature: 'Bertz_cat', correlation: -0.408, abs_correlation: 0.408 },
    { feature: 'Rq', correlation: -0.3637, abs_correlation: 0.3637 },
    { feature: 'logP_an', correlation: -0.3634, abs_correlation: 0.3634 },
    { feature: 'velocity', correlation: 0.3583, abs_correlation: 0.3583 },
  ],
}

export const SEMANTIC_MAP: Record<string, ColumnSemantic> = {
  r_cat: {
    title: '阳离子半径',
    meaning: 'Cation effective radius',
    explanation: '反映阳离子在界面中的空间尺寸和堆积能力。',
    unit: 'Å',
    modelHint: '常与分子量、可旋转键和疏水性形成尺寸共线块。',
  },
  logP_cat: {
    title: '阳离子 LogP',
    meaning: 'Cation MolLogP',
    explanation: '表征阳离子的疏水性或亲油性。',
    unit: '/',
    modelHint: '适合在尺寸簇中代表疏水性差异。',
  },
  MW_cat: {
    title: '阳离子分子量',
    meaning: 'Cation molecular weight',
    explanation: '反映阳离子整体质量与尺寸。',
    unit: 'g/mol',
    modelHint: '若已经保留半径或柔性指标,通常不必整簇重复保留。',
  },
  N_rot_cat: {
    title: '阳离子可旋转键',
    meaning: 'Cation rotatable bond count',
    explanation: '反映阳离子的柔性与构象自由度。',
    unit: '/',
    modelHint: '适合补充“柔性”信息,但要注意与分子量耦合。',
  },
  Bertz_cat: {
    title: '阳离子复杂度',
    meaning: 'Cation Bertz complexity index',
    explanation: '衡量阳离子拓扑结构复杂程度。',
    unit: '/',
    modelHint: '更适合作为结构复杂性的代表项。',
  },
  N_qN_cat: {
    title: '季铵氮数',
    meaning: 'Cation quaternary nitrogen count',
    explanation: '反映带正电中心的数量。',
    unit: '/',
    modelHint: '对界面吸附解释价值较强。',
  },
  TPSA_cat: {
    title: '阳离子 TPSA',
    meaning: 'Cation topological polar surface area',
    explanation: '反映极性位点暴露程度与潜在界面作用能力。',
    unit: 'Å²',
    modelHint: '适合代表极性维度。',
  },
  BalJ_cat: {
    title: '阳离子 Balaban J',
    meaning: 'Cation Balaban J index',
    explanation: '用于补充分子图拓扑和分支信息。',
    unit: '/',
    modelHint: '更适合作为补充特征,而不是首选代表项。',
  },
  N_HA_cat: {
    title: '阳离子受氢位点',
    meaning: 'Cation H-bond acceptor count',
    explanation: '表示可接受氢键的位点数。',
    unit: '/',
    modelHint: '可与 TPSA 联合判断极性是否真正重要。',
  },
  N_HD_cat: {
    title: '阳离子供氢位点',
    meaning: 'Cation H-bond donor count',
    explanation: '表示可提供氢键的位点数。',
    unit: '/',
    modelHint: '如果进入高敏感列表,通常值得优先保留。',
  },
  r_an: {
    title: '阴离子半径',
    meaning: 'Anion effective radius',
    explanation: '反映阴离子的空间尺寸与界面排布特征。',
    unit: 'Å',
    modelHint: '常与极性和疏水性共同构成阴离子共线簇。',
  },
  logP_an: {
    title: '阴离子 LogP',
    meaning: 'Anion MolLogP',
    explanation: '表征阴离子的疏水性或亲油性。',
    unit: '/',
    modelHint: '在含膜厚数据集中通常值得优先关注。',
  },
  MW_an: {
    title: '阴离子分子量',
    meaning: 'Anion molecular weight',
    explanation: '区分小阴离子与体积更大的有机阴离子。',
    unit: 'g/mol',
    modelHint: '若已保留疏水性或复杂度指标,可评估是否重复。',
  },
  Bertz_an: {
    title: '阴离子复杂度',
    meaning: 'Anion Bertz complexity index',
    explanation: '反映阴离子拓扑结构复杂程度。',
    unit: '/',
    modelHint: '适合代表结构复杂性。',
  },
  TPSA_an: {
    title: '阴离子 TPSA',
    meaning: 'Anion topological polar surface area',
    explanation: '体现阴离子极性区域大小和潜在界面作用能力。',
    unit: 'Å²',
    modelHint: '适合代表阴离子的极性维度。',
  },
  BalJ_an: {
    title: '阴离子 Balaban J',
    meaning: 'Anion Balaban J index',
    explanation: '用于补充分子图拓扑信息。',
    unit: '/',
    modelHint: '一般作为补充而非主代表特征。',
  },
  Y_s: {
    title: '表面自由能',
    meaning: 'Solid surface free energy',
    explanation: '反映固体表面对润湿和吸附的热力学倾向。',
    unit: 'J/m²',
    modelHint: '表面变量往往彼此共线,保留一个即可承载主要信息。',
  },
  σ_s: {
    title: '表面电荷密度',
    meaning: 'Solid surface charge density',
    explanation: '影响离子在界面的静电吸附和排布。',
    unit: 'C/m²',
    modelHint: '解释电场相关机制时价值更高。',
  },
  θ_s: {
    title: '接触角',
    meaning: 'Static contact angle',
    explanation: '用于表征表面的润湿性。',
    unit: '°',
    modelHint: '常与自由能、粗糙度形成表面信息簇。',
  },
  Rq: {
    title: '表面粗糙度',
    meaning: 'RMS surface roughness',
    explanation: '反映固体表面的微观起伏程度。',
    unit: 'nm',
    modelHint: '若对摩擦响应敏感,通常值得单独保留。',
  },
  I_ss: {
    title: '不锈钢基底指示',
    meaning: 'Stainless-steel substrate indicator',
    explanation: '表示样本是否来自不锈钢基底。',
    unit: '/',
    modelHint: '属于类别背景变量,适合保留为上下文特征。',
  },
  velocity: {
    title: '滑动速度',
    meaning: 'Sliding velocity',
    explanation: '直接影响摩擦测试的剪切条件。',
    unit: 'μm/s',
    modelHint: '属于工况变量,通常建议保留。',
  },
  Potential: {
    title: '偏压',
    meaning: 'Applied potential',
    explanation: '改变界面电场和离子排布。',
    unit: 'V',
    modelHint: '如果实验中存在电压变化,通常应保留。',
  },
  I_H2O: {
    title: '含水指示',
    meaning: 'Water-presence indicator',
    explanation: '表征体系中是否存在水或含水状态差异。',
    unit: '/',
    modelHint: '适合作为状态变量保留。',
  },
  x_IL: {
    title: '离子液体摩尔分数',
    meaning: 'Ionic-liquid molar fraction',
    explanation: '表征混合体系中离子液体的占比。',
    unit: '%',
    modelHint: '混合体系建模时通常不建议省略。',
  },
  Film_Thickness: {
    title: '膜厚 h',
    meaning: 'Interfacial film thickness',
    explanation: '描述受限液膜厚度,是含膜厚数据集中的关键机制变量。',
    unit: 'nm',
    modelHint: '如果目标是解释成膜机制,通常不建议删除。',
  },
  Cation_MolWt: {
    title: '阳离子分子量',
    meaning: 'Cation molecular weight',
    explanation: '反映阳离子整体尺寸与质量。',
    unit: 'g/mol',
    modelHint: '常与其他尺寸类特征共线。',
  },
  Cation_MolLogP: {
    title: '阳离子 LogP',
    meaning: 'Cation MolLogP',
    explanation: '表征阳离子疏水性。',
    unit: '/',
    modelHint: '适合代表疏水性维度。',
  },
  Cation_TPSA: {
    title: '阳离子 TPSA',
    meaning: 'Cation topological polar surface area',
    explanation: '反映极性暴露程度。',
    unit: 'Å²',
    modelHint: '适合代表极性维度。',
  },
  Cation_NumHDonors: {
    title: '阳离子供氢位点',
    meaning: 'Cation hydrogen bond donor count',
    explanation: '表示阳离子供氢位点数量。',
    unit: '/',
    modelHint: '解释界面相互作用时常有价值。',
  },
  Cation_NumHAcceptors: {
    title: '阳离子受氢位点',
    meaning: 'Cation hydrogen bond acceptor count',
    explanation: '表示阳离子受氢位点数量。',
    unit: '/',
    modelHint: '可与 TPSA 一起判断极性是否重要。',
  },
  Anion_MolWt: {
    title: '阴离子分子量',
    meaning: 'Anion molecular weight',
    explanation: '反映阴离子整体尺寸与质量。',
    unit: 'g/mol',
    modelHint: '可与疏水性代表项二选一。',
  },
  Anion_MolLogP: {
    title: '阴离子 LogP',
    meaning: 'Anion MolLogP',
    explanation: '表征阴离子疏水性。',
    unit: '/',
    modelHint: '含膜厚数据集里通常值得优先保留。',
  },
  Anion_TPSA: {
    title: '阴离子 TPSA',
    meaning: 'Anion topological polar surface area',
    explanation: '反映阴离子极性区域大小。',
    unit: 'Å²',
    modelHint: '适合代表阴离子极性。',
  },
  Surface_Roughness: {
    title: '表面粗糙度',
    meaning: 'Surface roughness',
    explanation: '反映固体表面的微观起伏程度。',
    unit: 'nm',
    modelHint: '若目标对表面形貌敏感,通常建议保留。',
  },
}

export function canonicalFeatureKey(feature: string) {
  return feature
    .toLowerCase()
    .replace(/^cation_/, 'cat_')
    .replace(/^anion_/, 'an_')
    .replace(/molwt/g, 'mw')
    .replace(/mollogp/g, 'logp')
    .replace(/numrotatablebonds/g, 'nrot')
    .replace(/bertzct/g, 'bertz')
    .replace(/balabanj/g, 'balj')
    .replace(/numhacceptors/g, 'nha')
    .replace(/numhdonors/g, 'nhd')
    .replace(/topologicalpolarsurfacearea/g, 'tpsa')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort()
    .join('-')
}

export function resolveFeatureForAvailable(
  feature: string,
  availableSet: Set<string>,
  availableColumns: string[],
): string | null {
  if (availableSet.has(feature)) return feature

  const aliases = FEATURE_ALIASES[feature] || []
  const aliased = availableColumns.find((column) => aliases.includes(column))
  if (aliased) return aliased

  const canonical = canonicalFeatureKey(feature)
  return availableColumns.find((column) => canonicalFeatureKey(column) === canonical) || null
}
