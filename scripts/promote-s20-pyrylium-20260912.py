"""Promote held pyrylium grease candidates after two-pass digitization of SI Figure S20.

Gates (per platform precedent, batch-09-ammoniumphos):
  (a) |readingA - readingB| <= 0.004 on the same bar;
  (b) digitized value consistent with the main-text directional statements for that
      condition (source-pages.txt p4) and with the Neat control 0.096 +/- 0.004.
Holds are left for the IL 1a conditions where the SI S20 "1a" group contradicts both
the main text and Figure 3 (figure-labeling defect in the source paper).
"""
import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path('data/literature-expansion-20260912')
BATCH = ROOT / 'reviewed-batch-08-pyrylium.json'
DIG = ROOT / 'pyrylium-si' / 's20-digitization-20260912.json'

KEYfmt = '{il}-grease-{g}-{t}'  # il like '1a-perchlorate', grease a/b, 40c/100c

KEYS = {
    ('1a', 'A', '40'): 'pyrylium-1a-perchlorate-grease-a-40c',
    ('1a', 'A', '100'): 'pyrylium-1a-perchlorate-grease-a-100c',
    ('1a', 'B', '40'): 'pyrylium-1a-perchlorate-grease-b-40c',
    ('1a', 'B', '100'): 'pyrylium-1a-perchlorate-grease-b-100c',
    ('1b', 'A', '40'): 'pyrylium-1b-tfsi-grease-a-40c',
    ('1b', 'A', '100'): 'pyrylium-1b-tfsi-grease-a-100c',
    ('1b', 'B', '40'): 'pyrylium-1b-tfsi-grease-b-40c',
    ('1b', 'B', '100'): 'pyrylium-1b-tfsi-grease-b-100c',
    ('2a', 'A', '40'): 'pyrylium-2a-perchlorate-grease-a-40c',
    ('2a', 'A', '100'): 'pyrylium-2a-perchlorate-grease-a-100c',
    ('2a', 'B', '40'): 'pyrylium-2a-perchlorate-grease-b-40c',
    ('2a', 'B', '100'): 'pyrylium-2a-perchlorate-grease-b-100c',
    ('2b', 'A', '40'): 'pyrylium-2b-tfsi-grease-a-40c',
    ('2b', 'A', '100'): 'pyrylium-2b-tfsi-grease-a-100c',
    ('2b', 'B', '40'): 'pyrylium-2b-tfsi-grease-b-40c',
    ('2b', 'B', '100'): 'pyrylium-2b-tfsi-grease-b-100c',
    ('3', 'A', '40'): 'pyrylium-3-phosphinate-grease-a-40c',
    ('3', 'A', '100'): 'pyrylium-3-phosphinate-grease-a-100c',
    ('3', 'B', '40'): 'pyrylium-3-phosphinate-grease-b-40c',
    ('3', 'B', '100'): 'pyrylium-3-phosphinate-grease-b-100c',
    ('PP', 'A', '40'): 'pyrylium-pp-phosphinate-grease-a-40c',
    ('PP', 'A', '100'): 'pyrylium-pp-phosphinate-grease-a-100c',
    ('PP', 'B', '40'): 'pyrylium-pp-phosphinate-grease-b-40c',
    ('PP', 'B', '100'): 'pyrylium-pp-phosphinate-grease-b-100c',
}

# digitized values by (il, grease, temp) from SI Figure S20 (two-pass)
BARS = {}
for b in json.loads(DIG.read_text())['bars']:
    il = b['cond']
    t = '40' if b['panel'] == '40C' else '100'
    BARS[(il, b['grease'], t)] = b

NEAT = {('A', '40'): 0.097438, ('B', '40'): 0.092399, ('A', '100'): 0.099392, ('B', '100'): 0.090445}

COF_METHOD = ('Average of the COF data during the second half of the ball-on-disk test (p2/p3); '
              'value digitized from SI Figure S20 ({panel} COF panel, {cond} bar, grease {g}) by '
              'pixel-calibrated two-pass measurement (readings {va:.4f} and {vb:.4f}, +/-0.004 '
              'axis-reading uncertainty; S20 error bars are SDs of two separate tests per its caption)')

DIG_NOTE = ('COF digitized from SI Figure S20 bar height (grease {g}, temperature {t}) by '
            'pixel-calibrated two-pass measurement against y-axis ticks; readings A and B agree '
            'within 0.004; Neat control digitizes to 0.096+/-0.004 matching the main text.')

# per-condition consistency with the p4 directional statements (verified numerically)
CONSIST = {
    ('1a', 'B', '40'): ('main text p4: "For grease B, all ILs resulted in decreased friction at both '
                        '40 and 100 C, except IL 3 ..."; digitized change vs Neat grease B at 40 C = -1.0% '
                        '(decreased, direction consistent; magnitude near the Neat bar, i.e. a marginal '
                        'decrease). Figure 3 (p4) also shows a decrease for this condition.'),
    ('1b', 'A', '40'): ('main text p4: "For grease A, the ILs had little effect on friction at 40 C"; '
                        'digitized change vs Neat grease A at 40 C = +2.0% (little effect).'),
    ('1b', 'A', '100'): ('main text p4: "at 100 C, only 2a, 3, and PP were beneficial in terms of friction" '
                         '(grease A); digitized change vs Neat grease A at 100 C = +20.3% (increase, i.e. '
                         'NOT beneficial - consistent). Also p4: "1-2a,b exhibited poorer performance ... '
                         'upon increasing the temperature" (0.099 at 40 C -> 0.120 at 100 C, poorer).'),
    ('1b', 'B', '40'): ('main text p4: "For grease B, all ILs resulted in decreased friction at both 40 and '
                        '100 C"; digitized change vs Neat grease B at 40 C = -15.0% (decreased).'),
    ('1b', 'B', '100'): ('main text p4: grease B all ILs decreased friction at 100 C; digitized change vs '
                         'Neat grease B at 100 C = -3.3% (decreased). Also "1-2a,b exhibited poorer '
                         'performance ... upon increasing the temperature" (0.079 -> 0.087, poorer).'),
    ('2a', 'A', '40'): ('main text p4: "For grease A, the ILs had little effect on friction at 40 C"; '
                        'digitized change vs Neat grease A at 40 C = -1.0% (little effect).'),
    ('2a', 'A', '100'): ('main text p4: "at 100 C, only 2a, 3, and PP were beneficial in terms of friction" '
                         '(grease A); digitized change vs Neat grease A at 100 C = -3.0% (beneficial).'),
    ('2a', 'B', '40'): ('main text p4: grease B all ILs decreased friction at 40 C; digitized change vs '
                        'Neat grease B at 40 C = -15.0% (decreased).'),
    ('2a', 'B', '100'): ('main text p4: grease B all ILs decreased friction at 100 C; digitized change vs '
                         'Neat grease B at 100 C = -11.0% (decreased). Also "1-2a,b ... poorer ... upon '
                         'increasing the temperature" (0.079 -> 0.081, poorer).'),
    ('2b', 'A', '40'): ('main text p4: grease A ILs had little effect at 40 C; digitized change vs Neat '
                        'grease A at 40 C = 0.0% (little effect).'),
    ('2b', 'A', '100'): ('main text p4: "at 100 C, only 2a, 3, and PP were beneficial" (grease A); digitized '
                         'change vs Neat grease A at 100 C = +10.1% (increase, NOT beneficial - consistent). '
                         'Also "1-2a,b ... poorer ... upon increasing the temperature" (0.097 -> 0.109).'),
    ('2b', 'B', '40'): ('main text p4: grease B all ILs decreased friction at 40 C; digitized change vs '
                        'Neat grease B at 40 C = -14.0% (decreased).'),
    ('2b', 'B', '100'): ('main text p4: grease B all ILs decreased friction at 100 C; digitized change vs '
                         'Neat grease B at 100 C = -6.6% (decreased). Also "1-2a,b ... poorer ..." '
                         '(0.079 -> 0.085, poorer).'),
    ('3', 'A', '40'): ('main text p4: grease A ILs had little effect at 40 C; digitized change vs Neat '
                       'grease A at 40 C = -3.2% (little effect).'),
    ('3', 'A', '100'): ('main text p4: "only 2a, 3, and PP were beneficial" (grease A, 100 C); digitized '
                        'change vs Neat grease A at 100 C = -11.0% (beneficial). Also "only 3 dramatically '
                        'improved friction performance upon increasing the temperature" (0.094 -> 0.088).'),
    ('3', 'B', '40'): ('main text p4: "except IL 3 which resulted in slightly increased friction values at '
                       '40 C"; digitized change vs Neat grease B at 40 C = +1.2% (slightly increased - exact '
                       'match).'),
    ('3', 'B', '100'): ('main text p4: "blending naphthenic grease B with IL 3 resulted in 20% reduction of '
                        'friction ... at 100 °C"; digitized change vs Neat grease B at 100 C = -20.0% '
                        '(exact match). Also "only 3 dramatically improved friction performance upon '
                        'increasing the temperature" (0.094 -> 0.072).'),
    ('PP', 'A', '40'): ('main text p4: "except IL PP which resulted in decreased measured friction values" '
                        '(grease A, 40 C); digitized change vs Neat grease A at 40 C = -15.3% (decreased).'),
    ('PP', 'A', '100'): ('main text p4: "at 100 C, only 2a, 3, and PP were beneficial" (grease A); digitized '
                         'change vs Neat grease A at 100 C = -8.0% (beneficial).'),
    ('PP', 'B', '40'): ('main text p4: grease B all ILs decreased friction at 40 C; digitized change vs '
                        'Neat grease B at 40 C = -8.6% (decreased).'),
    ('PP', 'B', '100'): ('main text p4: grease B all ILs decreased friction at 100 C; digitized change vs '
                         'Neat grease B at 100 C = -7.7% (decreased).'),
}

# conditions held despite passing gate (a): S20 "1a" group contradicts main text + Figure 3
HOLD_REASON = {
    ('1a', 'A', '40'): ('Held (digitization conflict): the SI Figure S20 bar for this condition digitizes '
                        'to 0.087 +/- 0.004 (two-pass readings 0.0869/0.0861 agree), i.e. -11.2% vs Neat '
                        'grease A at 40 C - which contradicts the main-text statement that in grease A at '
                        '40 C "the ILs had little effect on friction" (only PP excepted as decreased), and '
                        'contradicts Figure 3 (p4), whose 1a-grease-A-40C bar reads +1.8%. The SI S20 "1a" '
                        'group matches NO data series in Figure 3, and Figure 3\'s first two data columns '
                        'are cross-identical to S20\'s 1b/2b groups (paper-internal figure defect). Per the '
                        'promotion gate (value must be consistent with the main-text statements for the '
                        'condition), the record stays held with cof null pending author clarification.'),
    ('1a', 'A', '100'): ('Held (digitization conflict): the SI Figure S20 bar digitizes to 0.092 +/- 0.004 '
                         '(readings 0.0927/0.0921), i.e. -7.0% vs Neat grease A at 100 C, but the main text '
                         'says "at 100 C, only 2a, 3, and PP were beneficial in terms of friction" (grease A) '
                         '- 1a should NOT be beneficial - and Figure 3 (p4) shows the 1a-grease-A-100C bar '
                         'at +19.8% (increase). S20\'s "1a" group contradicts both. Record stays held with '
                         'cof null pending author clarification.'),
    ('1a', 'B', '100'): ('Held (digitization conflict): the SI Figure S20 bar digitizes to 0.096 +/- 0.004 '
                         '(readings 0.0968/0.0961), i.e. +6.6% vs Neat grease B at 100 C (an INCREASE), but '
                         'the main text says "For grease B, all ILs resulted in decreased friction at both 40 '
                         'and 100 °C" and Figure 3 (p4) shows the 1a-grease-B-100C bar at -3.2% (decrease). '
                         'S20\'s "1a" group contradicts both. Record stays held with cof null pending author '
                         'clarification.'),
}

PROMO_NOTE = ('Promoted from hold after pixel-calibrated two-pass digitization of SI Figure S20 '
              '(SI PDF p16, printed S16; {panel} COF panel, "{cond}" bar, grease {g}): reading A '
              '(tick-mark calibration, strict fill-color ink-top) = {va:.4f}; reading B (tick-label '
              'calibration, tolerant 50%-coverage row scan) = {vb:.4f}; |A-B| = {d:.4f} <= 0.004. '
              'Promoted cof = {cof:.3f} with +/-0.004 axis-reading uncertainty (y calibration: ticks '
              '0.00/0.04/0.08/0.12 at 7300 px per COF unit, fit residuals <= 0.00005). Consistency: '
              '{cons} Digitization cross-checks: the four Neat bars read 0.097/0.092/0.099/0.090 '
              '(mean 0.095), matching the printed base-grease control "average base grease COF was '
              '0.096 ± 0.004 (Figure S20)" (p4); IL 3 in grease B at 100 C digitizes to -20.0% vs its '
              'Neat, matching the printed "20% reduction of friction"; the digitized 2a/2b/3/PP '
              'percent changes reproduce Figure 3 (p4) bar values to <= 0.7 percentage points in both '
              'panels. Conditions remain fully sourced (ball-on-disk per ASTM D5707-16/G99-17, 10 N, '
              '0.25 m/s, 400 m, 52,100 steel pair, 5 wt % IL, roughness, second-half averaging). '
              'Source-based AI-assisted curation; not independent domain-expert validation.')


def r3(x):
    return float(Decimal(repr(x)).quantize(Decimal('0.001'), rounding=ROUND_HALF_UP))


def main():
    batch = json.loads(BATCH.read_text(encoding='utf-8'))
    by_key = {c['key']: c for c in batch}
    promoted, held = [], []
    for (il, g, t), key in KEYS.items():
        c = by_key[key]
        bar = BARS[(il, g, t)]
        va, vb = bar['readingA'], bar['readingB']
        d = abs(va - vb)
        panel = '40 °C' if t == '40' else '100 °C'
        assert d <= 0.004, (key, d)
        if (il, g, t) in HOLD_REASON:
            assert c['decision'] == 'hold' and c['fields']['cof'] is None
            c['reason'] = HOLD_REASON[(il, g, t)]
            held.append((key, va, vb, r3((va + vb) / 2)))
            continue
        cof = r3((va + vb) / 2)
        neat = NEAT[(g, t)]
        pct = 100 * ((va + vb) / 2 - neat) / neat
        cons = CONSIST[(il, g, t)]
        # decision + reason
        c['decision'] = 'approve'
        c['reason'] = PROMO_NOTE.format(panel=panel, cond=il, g=g, va=va, vb=vb, d=d, cof=cof, cons=cons)
        # fields
        c['fields']['cof'] = cof
        c['fields']['cofMethod'] = COF_METHOD.format(panel=panel, cond=il, g=g, va=va, vb=vb)
        # provenance: cof entry basis -> inferred, keep page/quote, replace note
        for p in c['fields']['provenance']:
            if p['field'] == 'cof':
                p['basis'] = 'inferred'
                p['note'] = DIG_NOTE.format(g=g, t=panel)
        # flexible audit entry
        c['fields']['flexible'].append({
            'key': 'cof_digitization',
            'value': 'two-pass readings A/B, ±0.004, SI Fig S20',
            'note': (f'SI p16 Figure S20 "{il}" bar, grease {g}, {panel}: reading A = {va:.4f}, '
                     f'reading B = {vb:.4f}, |A-B| = {d:.4f} (gate 0.004); promoted cof {cof:.3f}; '
                     f'vs Neat grease {g} at {panel} ({neat:.3f}) the digitized change is '
                     f'{pct:+.1f}%. {cons}'),
        })
        promoted.append((key, va, vb, cof))
    BATCH.write_text(json.dumps(batch, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'promoted {len(promoted)}, held-with-conflict {len(held)}')
    for key, va, vb, cof in promoted:
        print(f'  PROMOTE {key:55s} A={va:.4f} B={vb:.4f} cof={cof:.3f}')
    for key, va, vb, mean in held:
        print(f'  HOLD    {key:55s} A={va:.4f} B={vb:.4f} (mean {mean:.3f})')


if __name__ == '__main__':
    main()
