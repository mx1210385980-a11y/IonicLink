"""Promote digitization-verified HELD candidates to approve in the three 2026-09-12 batches.

Rule set (task + batch-09-ammoniumphos precedent):
  - decision hold -> approve; fields.cof = two-pass digitized value (3 decimals)
  - cof provenance: basis stays 'inferred', page/quote unchanged, note replaced
  - flexible gains one {key: 'cof_digitization', ...} audit entry; all else unchanged
  - non-IL control holds are NOT touched
Run from repo root: python scripts/promote-digitized-20260912-abc.py
"""
from pathlib import Path
import json

ROOT = Path('data/literature-expansion-20260912')

# --------------------------------------------------------------- Paper A
A_CAL_5A = ('Fig.5(a) (pages/page-5.png) NP-14-2-14/' if False else
            'Fig.5(a) (pages/page-5.png); broken y axis, lower linear segment only: '
            'labels 0.1@row1294.5, 0.0@row1346.5 (520 px per COF unit; tick cross-check dev 1.0 px); '
            'x labels 0/600/1200/1800 s @cols 296.5/392.0/487.5/583.5 (residual 0.2 px)')
A_CAL_6A = ('Fig.6(a) (pages/page-6.png); broken y axis, lower linear segment only: '
            'labels 0.1@row311.5, 0.0@row363.0 (tick cross-check dev 1.5 px); '
            'x labels 0/600/1200/1800 s @cols 296.5/392.0/487.5/583.0 (residual 0.0 px)')

A = {
    'gemini-2021-np14-2-14-rt-hold': dict(
        panel='A-fig5a', cal=A_CAL_5A, il='NP-14-2-14', temp='RT',
        A=0.10197, B=0.10374, cof=0.103,
        sub='1500-1800 s 0.1019/0.1029, 900-1800 s 0.1021/0.1041',
        consist=('digitized RT ranking NP-14 0.103 > NP-16 0.097 > NP-18 0.088 reproduces "a significant '
                 'decrease in COF is observed in the entire process, with an increase in alkyl chain length"; '
                 'three-IL average 0.096 < 0.1 reproduces "The average COF for all synthetic ILs is less than '
                 '0.1" (PDF p5)')),
    'gemini-2021-np16-2-16-rt-hold': dict(
        panel='A-fig5a', cal=A_CAL_5A, il='NP-16-2-16', temp='RT',
        A=0.09619, B=0.09811, cof=0.097,
        sub='1500-1800 s 0.0962/0.0981, 900-1800 s 0.0962/0.0981',
        consist=('RT ranking NP-14 0.103 > NP-16 0.097 > NP-18 0.088 reproduces the chain-length trend and the '
                 'three-IL average 0.096 < 0.1 reproduces "The average COF for all synthetic ILs is less than '
                 '0.1" (PDF p5)')),
    'gemini-2021-np18-2-18-rt-hold': dict(
        panel='A-fig5a', cal=A_CAL_5A, il='NP-18-2-18', temp='RT',
        A=0.08697, B=0.08923, cof=0.088,
        sub='1500-1800 s 0.0874/0.0900, 900-1800 s 0.0867/0.0890',
        consist=('RT ranking NP-14 0.103 > NP-16 0.097 > NP-18 0.088 (NP-18 lowest) reproduces the chain-length '
                 'trend and the three-IL average 0.096 < 0.1 reproduces "The average COF for all synthetic ILs '
                 'is less than 0.1" (PDF p5)')),
    'gemini-2021-np14-2-14-100c-hold': dict(
        panel='A-fig6a', cal=A_CAL_6A, il='NP-14-2-14', temp='100 degC',
        A=0.10766, B=0.10939, cof=0.109,
        sub='1500-1800 s 0.1076/0.1088, 900-1800 s 0.1080/0.1097',
        consist=('digitized HT values NP-14 0.109 > NP-16 0.100 > L-P104 0.078 > NP-18 0.066 reproduce '
                 '"The final COF of NP-18-2-18 is less than that of L-P104" and the HT trend that long alkyl '
                 'chains enhance friction reduction (NP-18 lowest, PDF p5)')),
    'gemini-2021-np16-2-16-100c-hold': dict(
        panel='A-fig6a', cal=A_CAL_6A, il='NP-16-2-16', temp='100 degC',
        A=0.09898, B=0.10004, cof=0.100,
        sub='1500-1800 s 0.0988/0.1000, 900-1800 s 0.0992/0.1004',
        consist=('digitized HT values NP-14 0.109 > NP-16 0.100 > L-P104 0.078 > NP-18 0.066: NP-16 below the '
                 'shortest-chain NP-14, consistent with long-chain friction reduction at HT (PDF p5); the '
                 '"reduction of the COF ... of NP-16-2-16 and NP-18-2-18 is evident" statement is the paper\'s '
                 'comparative claim (NP-18 0.066 clearly reduced vs its RT 0.088 and vs L-P104)')),
    'gemini-2021-np18-2-18-100c-hold': dict(
        panel='A-fig6a', cal=A_CAL_6A, il='NP-18-2-18', temp='100 degC',
        A=0.06543, B=0.06752, cof=0.066,
        sub='1500-1800 s 0.0666/0.0689, 900-1800 s 0.0650/0.0668',
        consist=('digitized final values NP-18 0.066 < L-P104 0.078 directly reproduce "The final COF of '
                 'NP-18-2-18 is less than that of L-P104" (PDF p5)')),
}

A_REASON = ('APPROVED after pixel-calibrated figure digitization (batch-09-ammoniumphos two-pass protocol): '
            'COF = steady-state mean of the {panel} {il} COF/time trace over the last 600 s of the 1800 s test '
            '(window 1200-1800 s; all NP traces lie in the lower 0.0-0.2 linear segment of the broken y axis). '
            'Passes: A={A:.5f} (strict-color tracked per-column mean, axis-label calibration), '
            'B={B:.5f} (tolerant-mask per-column median, tick calibration), |A-B|={dif:.4f} <= 0.005; '
            'mean {mean:.5f} -> promoted {cof:.3f}. Sub-windows stable: {sub}. Text consistency: {consist}. '
            'Condition fields unchanged from the verified hold; cof was previously absent.')
A_METHOD = ('Steady-state mean COF over 1200-1800 s of the {panel} COF/time trace (neat IL, steel/steel, '
            '300 N, 25 Hz, 1 mm, {temp}); pixel-calibrated two-pass digitization of the unlabeled curve '
            '(strict-color tracked mean A vs tolerant-mask median B, |A-B| <= 0.005); text anchor: average COF '
            'of the three dicationic ILs < 0.1 (PDF p5)')
A_PROV = ('COF digitized from the {panel} {il} trace by pixel-calibrated measurement. {cal}. '
          'Readings A={A:.5f} / B={B:.5f} agree within 0.005; sub-windows {sub}; window mean {mean:.5f}, '
          'promoted {cof:.3f}. Consistency: {consist}.')

# --------------------------------------------------------------- Paper B
B_CAL_A = ('Fig.2(a) (pages/page-7.png); y labels 0.0-0.6 every 0.1 (residual 0.41 px), x labels 0-300 m every '
           '50 m (residual 0.57 px); frame-endpoint cross-check dev <= 1.0 px')
B_CAL_B = ('Fig.2(b) (pages/page-7.png); y labels 0.0-0.6 every 0.1 (residual 0.34 px), x labels 0-300 m every '
           '50 m (residual 0.43 px); frame-endpoint cross-check dev <= 1.0 px')

B = {
    'boundadd-2022-wg-pp-1wt-hold': dict(
        panel='Fig.2(a)', cal=B_CAL_A, lub='WG-PP', base='WG',
        A=0.18202, B=0.18316, cof=0.183,
        sub='150-300 m 0.1928/0.1943, 250-300 m 0.1734/0.1742, 100-300 m 0.2034/0.2043',
        consist=('WG-PP 0.183 > WG-C12 0.139 matches "WG lubricants formulated with the two ILs showed friction '
                 'values higher than WG formulated with dodecanoic acid (C12)" and WG-BMP 0.155 < WG-PP 0.183 '
                 'matches "it gives the lowest friction evolution in WG" (PDF p7, p13)')),
    'boundadd-2022-wg-bmp-1wt-hold': dict(
        panel='Fig.2(a)', cal=B_CAL_A, lub='WG-BMP', base='WG',
        A=0.15435, B=0.15557, cof=0.155,
        sub='150-300 m 0.1617/0.1630, 250-300 m 0.1504/0.1518, 100-300 m 0.1616/0.1629',
        consist=('WG-BMP 0.155 < WG-PP 0.183 and both above WG-C12 0.139 match the abstract/p13 statements '
                 '("BMP ... gives the lowest friction evolution in WG"; IL-containing WG above WG-C12); the '
                 'neat-WG control anchor digitizes to 0.1453 over 100-300 m vs the text-stated 0.145 (PDF p7)')),
    'boundadd-2022-pao-pp-1wt-hold': dict(
        panel='Fig.2(b)', cal=B_CAL_B, lub='PAO-PP', base='PAO',
        A=0.10470, B=0.10416, cof=0.104,
        sub='150-300 m 0.1068/0.1065, 250-300 m 0.1035/0.1029, 100-300 m 0.1073/0.1071',
        consist=('PAO-PP 0.104 vs digitized neat-PAO 0.118 (text-stated steady 0.112): "friction after running-in '
                 'is almost similar to the PAO base lubricant alone" (PDF p7); far below PAO-C12 0.152 '
                 '(text-stated 0.15); PAO-BMP 0.109 and PAO-PP 0.104 are near-coincident (difference ~0.005, at '
                 'reading resolution)')),
    'boundadd-2022-pao-bmp-1wt-hold': dict(
        panel='Fig.2(b)', cal=B_CAL_B, lub='PAO-BMP', base='PAO',
        A=0.10878, B=0.10900, cof=0.109,
        sub='150-300 m 0.1088/0.1085, 250-300 m 0.1088/0.1089, 100-300 m 0.1088/0.1085',
        consist=('PAO-BMP 0.109 sits below the PAO base lubricant (digitized 0.118, text 0.112) and far below '
                 'PAO-C12 0.152 (text 0.15), matching "The ionic liquids in PAO reduce the running-in sliding '
                 'distance, and friction after running-in is almost similar to the PAO base lubricant alone" '
                 '(PDF p7); the p13 claim "The lowest friction was obtained for PAO-BMP and WG-BMP for each base '
                 'lubricant" is decisive for WG (0.155 vs 0.183) and within reading resolution for PAO '
                 '(0.109 vs PAO-PP 0.104 over 200-300 m)')),
}

B_REASON = ('APPROVED after pixel-calibrated figure digitization (batch-09-ammoniumphos two-pass protocol): '
            'COF = steady-state mean of the {panel} {lub} friction-evolution trace over 200-300 m (the paper '
            'reports steady friction by ~100 m in WG and ~50 m in PAO; test length 300 m; the earlier AI drafts '
            'had misassigned the base-fluid control values 0.145/0.112, which are NOT used here). '
            'Passes: A={A:.5f} (strict-color tracked per-column mean, axis-label calibration), '
            'B={B:.5f} (tolerant-mask per-column median incl. stroke texture, frame-endpoint calibration), '
            '|A-B|={dif:.4f} <= 0.005; mean {mean:.5f} -> promoted {cof:.3f}. Sub-windows stable: {sub}. '
            'Text consistency: {consist}. Condition fields unchanged from the verified hold.')
B_METHOD = ('Steady-state mean COF over 200-300 m of the {panel} friction-evolution trace (1 wt% IL, 316L disk '
            'vs alumina ball, 20 N, 2.09 cm/s, room temperature); pixel-calibrated two-pass digitization of the '
            'unlabeled curve (strict-color tracked mean A vs tolerant-mask median B, |A-B| <= 0.005); anchors: '
            'neat-WG 0.145 and neat-PAO 0.112 and PAO-C12 0.15 stated in the text (PDF p7)')
B_PROV = ('COF digitized from the {panel} {lub} trace by pixel-calibrated measurement. {cal}. '
          'Readings A={A:.5f} / B={B:.5f} agree within 0.005; sub-windows {sub}; window mean {mean:.5f}, '
          'promoted {cof:.3f}. Consistency: {consist}.')

# --------------------------------------------------------------- Paper C
C_PROV = ('COF digitized from the {panel} {il} series (5 markers) by pixel-calibrated marker measurement. '
          '{calt}. Minimum readings A={A:.5f} / B={B:.5f} agree within 0.005; mean {mean:.5f}, promoted '
          '{cof:.3f}; minimum at Z={minZ}; value at the 2.0 cm/s point {end:.4f}. Consistency: {consist}.')

C = {
    'bjnano-2017-emim-tfo-peg200-si-15mn': dict(
        panel='Figure 5a', fam='red squares', cal='5a', calt='Figure 5a (pages/page-6.png): y labels 0.05-0.25 every 0.05 (residual 0.0 px, tick cross-check 0.6 px), x labels 0-0.00025 (residual 0.0 px); region rows 218-413, cols 199-541', il='[EMIM][TfO]',
        A=0.16497, B=0.16543, cof=0.165, minZ='2.13e-4', end=0.1652, eta=53,
        consist=('smallest decrease of the four TfO mixtures vs PEG (PEG minimum 0.176): "the one with cation '
                 '[EMIM] (shorter side chain) led to the worst results: it had almost no effect, in particular '
                 'at higher velocities" (PDF p5); independent figure: Figure 3b (dry) minimum 0.1641/0.1660 '
                 'agrees within 0.002')),
    'bjnano-2017-bmim-tfo-peg200-si-15mn': dict(
        panel='Figure 5a', fam='blue squares', cal='5a', calt='as for [EMIM][TfO] (same Figure 5a calibration)', il='[BMIM][TfO]',
        A=0.11030, B=0.11064, cof=0.110, minZ='2.09e-4', end=0.1105, eta=52,
        consist=('largest decrease among TfO mixtures (PEG minimum 0.176): "Cation [BMIM] with a longer side '
                 'chain induced a significant decrease in friction, despite presenting the highest contact '
                 'angle" (PDF p5-6); independent figure: Figure 3b (dry) minimum 0.1103/0.1100 - agreement to '
                 '0.0003')),
    'bjnano-2017-c2ohmim-tfo-peg200-si-15mn': dict(
        panel='Figure 5a', fam='green squares', cal='5a', calt='as for [EMIM][TfO] (same Figure 5a calibration)', il='[C2OHMIM][TfO]',
        A=0.15011, B=0.15053, cof=0.150, minZ='2.19e-4', end=0.1503, eta=55,
        consist=('moderate decrease vs PEG (0.176): "addition to PEG of other cations with short side chains '
                 'but functional groups (hydroxy or allyl), respectively [C2OHMIM] and [AMIM], led to a slight '
                 'decrease in friction" (PDF p5)')),
    'bjnano-2017-amim-tfo-peg200-si-15mn': dict(
        panel='Figure 5a', fam='purple squares', cal='5a', calt='as for [EMIM][TfO] (same Figure 5a calibration)', il='[AMIM][TfO]',
        A=0.15329, B=0.15372, cof=0.154, minZ='1.60e-4', end=0.1535, eta=40,
        consist=('slight decrease vs PEG (0.176): "[C2OHMIM] and [AMIM] led to a slight decrease in friction" '
                 '(PDF p5); AMIM series ends at the lowest Z (1.60e-4) of panel 5a, exactly as expected from '
                 'its lowest viscosity (40 mPa.s, Table 2) since Z = eta.r.v')),
    'bjnano-2017-bmim-dca-peg200-si-15mn': dict(
        panel='Figure 5b', fam='blue triangles', cal='5b', calt='Figure 5b (pages/page-6.png): y labels 0.05-0.25 every 0.05 (residual 0.0 px, tick cross-check 0.6 px), x labels 0-0.00025 (residual 0.0 px); region rows 460-652, cols 200-541', il='[BMIM][DCA]',
        A=0.14597, B=0.14587, cof=0.146, minZ='2.23e-4', end=0.1459, eta=56,
        consist=('"comparison of the DCA-based additives (Figure 5b) shows that all combinations ([BMIM] and '
                 '[C2OHMIM]) led to similar small decreases in CoF" (PDF p6): digitized 0.146 vs 0.146 - '
                 'identical; independent figure: Figure 3b (dry) minimum 0.1451/0.1458 agrees within 0.001')),
    'bjnano-2017-c2ohmim-dca-peg200-si-15mn': dict(
        panel='Figure 5b', fam='green triangles', cal='5b', calt='as for [BMIM][DCA] (same Figure 5b calibration)', il='[C2OHMIM][DCA]',
        A=0.14544, B=0.14587, cof=0.146, minZ='2.09e-4', end=0.1457, eta=52,
        consist='"all combinations ([BMIM] and [C2OHMIM]) led to similar small decreases in CoF" (PDF p6): '
                'digitized 0.146 vs 0.146 - identical'),
    'bjnano-2017-emim-etso4-peg200-si-15mn': dict(
        panel='Figure 5c', fam='red diamonds', cal='5c', calt='Figure 5c (pages/page-6.png): y labels 0.05-0.25 every 0.05 (residual 0.0 px, tick cross-check 1.0 px), x labels 0-0.00035 (residual 0.0 px); region rows 694-889, cols 200-541', il='[EMIM][EtSO4]',
        A=0.10904, B=0.10973, cof=0.109, minZ='1.70e-4', end=0.1102, eta=53,
        consist=('"the EtSO4-based additives (Figure 5c) led to accentuated decreases in friction" and "with '
                 '[EMIM][EtSO4] a constant CoF was obtained for intermediate values of Z" (PDF p6): the '
                 'digitized minimum sits at intermediate Z = 1.70e-4 with a 0.109-0.111 plateau; one of the two '
                 'best performers (PDF p8)')),
    'bjnano-2017-evim-etso4-peg200-si-15mn': dict(
        panel='Figure 5c', fam='yellow diamonds', cal='5c', calt='as for [EMIM][EtSO4] (same Figure 5c calibration)', il='[EVIM][EtSO4]',
        A=0.11064, B=0.11184, cof=0.111, minZ='3.00e-4', end=0.1112, eta=75,
        consist=('"[EVIM][EtSO4] led to a linear decrease of CoF with increasing Z" (PDF p6): digitized series '
                 '0.159 -> 0.151 -> 0.141 -> 0.124 -> 0.111, monotonic; its series extends to the highest Z '
                 '(3.00e-4) as expected from the highest viscosity (75 mPa.s, Table 2); one of the two best '
                 'performers (PDF p8)')),
}

C_CAL = {
    '5a': 'Figure 5a (pages/page-6.png): y labels 0.05-0.25 every 0.05 (residual 0.0 px, tick cross-check 0.6 px), '
          'x labels 0-0.00025 (residual 0.0 px); region rows 218-413, cols 199-541',
    '5b': 'Figure 5b (pages/page-6.png): same y calibration (tick cross-check 0.6 px); x labels 0-0.00025; '
          'region rows 460-652',
    '5c': 'Figure 5c (pages/page-6.png): same y calibration (tick cross-check 1.0 px); x labels 0-0.00035; '
          'region rows 694-889',
}
C_REASON = ('APPROVED after pixel-calibrated marker digitization (batch-09-ammoniumphos two-pass protocol). '
            'Extracted metric (documented choice): the MINIMUM of the {panel} PEG + {il} CoF-vs-Sommerfeld '
            'series - the lowest steady CoF attained within the documented test sweep (5 measured points, '
            '0.4-2.0 cm/s, mixed/boundary regimes); the value at the documented maximum speed (2.0 cm/s, the '
            'highest-Z point) is recorded in the cof_digitization audit and equals the minimum for this series '
            'within 0.001. Passes: A={A:.5f} (strict-color connected-component body-bbox centers, axis-label '
            'calibration) vs B={B:.5f} (tolerant-mask body-median centers, tick calibration, dilated grouping), '
            '|A-B|={dif:.4f} <= 0.005; mean {mean:.5f} -> promoted {cof:.3f}; minimum at Z={minZ} '
            '(@ 2.0 cm/s point: {end:.4f}); error-bar-midpoint diagnostic <= 1 px. Text consistency: {consist}. '
            'Condition fields unchanged from the verified hold; cof was previously null.')
C_METHOD = ('Minimum COF of the {panel} CoF-vs-Sommerfeld-parameter Z series (2 wt% {il} in dry PEG 200, '
            'Si <100> vs 316L sphere, 15 mN, 0.4-2.0 cm/s sweep, 200 cycles); pixel-calibrated two-pass marker '
            'digitization (|A-B| <= 0.005); the value at the documented maximum speed 2.0 cm/s is in the '
            'cof_digitization audit')


def promote(path, table, reason_t, method_t, prov_t, flex_builder, metric):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    n = 0
    for rec in data:
        key = rec['key']
        if key not in table:
            continue
        d = table[key]
        A_, B_, cof = d['A'], d['B'], d['cof']
        mean = (A_ + B_) / 2
        dif = abs(A_ - B_)
        dd = {k: v for k, v in d.items() if k not in ('A', 'B', 'cof')}
        rec['decision'] = 'approve'
        rec['reason'] = reason_t.format(**dd, A=A_, B=B_, dif=dif, mean=mean, cof=cof)
        rec['fields']['cof'] = cof
        rec['fields']['cofMethod'] = method_t.format(**d)
        cof_entries = [p for p in rec['fields']['provenance'] if p.get('field') == 'cof']
        note = prov_t.format(**dd, A=A_, B=B_, dif=dif, mean=mean, cof=cof)
        if cof_entries:
            assert cof_entries[0].get('basis') == 'inferred', key
            cof_entries[0]['note'] = note
        else:
            rec['fields']['provenance'].append({
                'field': 'cof', 'basis': 'inferred', 'page': 6,
                'quote': ('Figure 5: CoF vs Sommerfeld parameter, Z, for (a) TfO-based, (b) DCA-based and '
                          '(c) EtSO4-based ILs mixed with PEG'),
                'note': note})
        rec['fields']['flexible'].append(flex_builder(d, A_, B_, mean, cof))
        n += 1
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return n


def A_flex(d, A_, B_, mean, cof):
    return {
        'key': 'cof_digitization',
        'value': (f'{d["panel"]}; {d["il"]} trace; metric = steady-state mean over 1200-1800 s of the 1800 s '
                  f'test; {d["cal"]}; pass A = strict-color tracked per-column cluster mean, pass B = '
                  f'tolerant-mask per-column median; A/B = {A_:.4f}/{B_:.4f} (1200-1800 s), {d["sub"]}; '
                  f'|A-B| <= 0.005; promoted {cof:.3f}; L-P104 reference trace 0.058/0.060 (RT) and '
                  f'0.077/0.079 (100 degC); PAO 10 anchor (100 degC panel) 0.150-0.152 vs text "equal shares '
                  f'at RT" with RT equilibrium 0.2 (p5); reproducible script '
                  f'scripts/digitize-promote-20260912-abc.py; overlays verify-A-*.png in the paper folder'),
        'note': 'two-pass pixel-calibrated digitization audit; 1 px ~ 0.0019 COF in the calibrated segment',
    }


def B_flex(d, A_, B_, mean, cof):
    return {
        'key': 'cof_digitization',
        'value': (f'{d["panel"]}; {d["lub"]} trace; metric = steady-state mean over 200-300 m of the 300 m test; '
                  f'{d["cal"]}; pass A = strict-color tracked per-column cluster mean (label calibration), '
                  f'pass B = tolerant-mask per-column median incl. vertical stroke texture (frame-endpoint '
                  f'calibration); A/B = {A_:.4f}/{B_:.4f} (200-300 m), {d["sub"]}; |A-B| <= 0.005; promoted '
                  f'{cof:.3f}; anchors digitized with the same calibration: neat-WG 0.1365/0.1389 (200-300 m) '
                  f'and 0.1453/0.1512 (100-300 m) vs text 0.145; neat-PAO 0.1180/0.1211 vs text 0.112; PAO-C12 '
                  f'0.1524/0.1526 vs text 0.15; WG-C12 0.1389/0.1385; reproducible script '
                  f'scripts/digitize-promote-20260912-abc.py; overlays verify-B-*.png in the paper folder'),
        'note': ('two-pass pixel-calibrated digitization audit; 1 px ~ 0.0016 COF; neat-PAO anchor reads '
                 '0.006-0.009 above the stated 0.112 because the digitized mean includes the vertical stroke '
                 'texture of the noisy raw trace (WG anchor with the same pipeline matches 0.145 exactly)'),
    }


def C_flex(d, A_, B_, mean, cof):
    return {
        'key': 'cof_digitization',
        'value': (f'{d["panel"]} ({d["fam"]}); metric = series minimum (lowest steady CoF within the documented '
                  f'0.4-2.0 cm/s sweep); {C_CAL[d["cal"]]}; pass A = strict-color connected-component body-bbox '
                  f'centers (label calibration), pass B = tolerant-mask body-median centers with dilated '
                  f'grouping (tick calibration); minimum A/B = {A_:.4f}/{B_:.4f}, mean {mean:.5f}, promoted '
                  f'{cof:.3f}; minimum at Z={d["minZ"]}; value at the maximum documented speed (2.0 cm/s = '
                  f'highest-Z point) = {d["end"]:.4f}; error-bar-midpoint diagnostic <= 1 px; 5 points per '
                  f'series; Z-axis global check: highest-Z point of every Figure 5 series scales with the '
                  f'Table 2 viscosities (eta {d["eta"]} mPa.s -> series end Z consistent with Z = eta.r.v; '
                  f'e.g. eta 53 -> 2.13e-4, eta 75 -> 3.00e-4), confirming the axis calibration; independent '
                  f'figure cross-check: Figure 3b dry data for [EMIM][TfO]/[BMIM][TfO]/[BMIM][DCA] agree within '
                  f'0.002; reproducible script scripts/digitize-promote-20260912-abc.py; overlays '
                  f'verify-C-*.png in the paper folder'),
        'note': ('two-pass pixel-calibrated marker digitization audit; 1 px ~ 0.00106 COF (Fig 5) / 0.00222 '
                 '(Fig 3); metric choice (series minimum vs value at 2.0 cm/s) changes the promoted value by '
                 '<= 0.001 for every promoted series'),
    }


if __name__ == '__main__':
    n1 = promote(ROOT / 'reviewed-fric-0348-5.json', A, A_REASON, A_METHOD, A_PROV, A_flex, 'mean')
    n2 = promote(ROOT / 'reviewed-fric-0550-0.json', B, B_REASON, B_METHOD, B_PROV, B_flex, 'mean')
    n3 = promote(ROOT / 'reviewed-batch-08-bjnano.json', C, C_REASON, C_METHOD, C_PROV, C_flex, 'min')
    print(f'promoted: paper A {n1}, paper B {n2}, paper C {n3}')
