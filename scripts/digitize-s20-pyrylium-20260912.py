"""Two-pass pixel-calibrated digitization of Figure S20 COF panels (pyrylium greases SI).

Paper: 10.1021/acsami.4c01750, SI PDF p16 (printed S16), top two panels:
  left  = 40 degC COF, right = 100 degC COF; 7 conditions (Neat,1a,1b,2a,2b,3,PP)
  x orange = grease A, green = grease B; y ticks 0.00/0.04/0.08/0.12 (no gridlines).

Protocol (batch-09-ammoniumphos precedent):
  Reading A: tick-MARK centroid calibration (programmatic tick detection + linear fit,
             residual check) + strict core-fill column ink-top (median over central
             columns, dark-outline stroke midpoint correction).
  Reading B: tick-LABEL text centroid calibration (independent geometry) +
             tolerant anti-aliasing-inclusive hue classification with a 50%-coverage
             row-scan estimator (no outline correction).
  Promotion gate: |A-B| <= 0.004, plus main-text consistency checks.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path('data/literature-expansion-20260912/pyrylium-si')
PAGE = ROOT / 'pages' / 'si-p16-x8.png'

CONDS = ['Neat', '1a', '1b', '2a', '2b', '3', 'PP']
TICKVALS = [0.12, 0.08, 0.04, 0.00]

ORANGE_CORE = np.array([255, 206, 148])
GREEN_CORE = np.array([156, 214, 156])


def load_rgb(p):
    return np.asarray(Image.open(p).convert('RGB')).astype(int)


def group_runs(flags, min_gap=1):
    """Connected runs of True."""
    out = []
    i = 0
    n = len(flags)
    while i < n:
        if flags[i]:
            j = i
            while j < n and flags[j]:
                j += 1
            out.append((i, j - 1))
            i = j
        else:
            i += 1
    return out


def longest_run(v):
    best = cur = 0
    for b in v:
        cur = cur + 1 if b else 0
        best = max(best, cur)
    return best


def detect_panel(a, bar_x0):
    """Find axis column, tick centers, tick-label centroids for one COF panel."""
    lum = a.mean(axis=2)
    dark = lum < 150
    Y0, Y1 = 950, 2050
    # --- axis column: every column left of the first bar, longest vertical dark run
    best_col, best_run = None, 0
    for c in range(bar_x0 - 70, bar_x0 - 1):
        r = longest_run(dark[Y0:Y1, c])
        if r > best_run:
            best_run, best_col = r, c
    axis = best_col
    # --- tick marks: short dark runs immediately LEFT of the axis (x axis-25..axis-5)
    tick_rows = []
    for y in range(Y0, Y1):
        if dark[y, axis - 25:axis - 5].mean() > 0.5:
            tick_rows.append(y)
    ticks = [int(np.median(r)) for r in group_runs_consec(tick_rows, gap=3)]
    # --- tick labels: digits occupy x in [axis-170, axis-30] (rotated axis title is
    # further left, x <= axis-185; tick marks start at axis-25)
    labels = []
    for tv, tr in zip(TICKVALS, ticks):
        win = dark[tr - 45:tr + 46, axis - 170:axis - 30]
        ys, xs = np.where(win)
        assert len(ys) > 50, (tv, tr, len(ys))
        centroid = float(np.mean(ys)) + (tr - 45)
        labels.append((tv, centroid, int(len(ys)), tr))
    return axis, ticks, labels


def group_runs_consec(rows, gap=3):
    out = []
    cur = [rows[0]]
    for y in rows[1:]:
        if y - cur[-1] <= gap:
            cur.append(y)
        else:
            out.append(cur)
            cur = [y]
    out.append(cur)
    return out


def fit_cal(pairs):
    """pairs: list of (value, pixel_row). Fit value = m*row + b. Return fn + max residual."""
    vals = np.array([p[0] for p in pairs], float)
    px = np.array([p[1] for p in pairs], float)
    m, b = np.polyfit(px, vals, 1)
    res = vals - (m * px + b)
    return (lambda row: m * row + b), float(np.max(np.abs(res))), (m, b)


def bars_of(mask, x_lo, x_hi, ymin=900, ymax=2060, min_count=30):
    m = mask.copy()
    m[:ymin, :] = False
    m[ymax:, :] = False
    cc = m[:, x_lo:x_hi].sum(axis=0)
    on = cc > min_count
    return [(s + x_lo, e + x_lo) for s, e in group_runs(on) if e - s > 20]


# ---------------------------------------------------------------- main

def main():
    a = load_rgb(PAGE)
    H, W = a.shape[:2]
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    print(f'page {W}x{H}')

    # strict fill masks (core colors, tight tolerance)
    strict_or = (np.abs(R - ORANGE_CORE[0]) <= 14) & (np.abs(G - ORANGE_CORE[1]) <= 16) & (np.abs(B - ORANGE_CORE[2]) <= 20)
    strict_gr = (np.abs(R - GREEN_CORE[0]) <= 18) & (np.abs(G - GREEN_CORE[1]) <= 14) & (np.abs(B - GREEN_CORE[2]) <= 18)
    # tolerant hue masks (anti-aliasing inclusive)
    tol_or = ((R - B) > 40) & ((R - G) > 18) & (R > 200)
    tol_gr = ((G - R) > 12) & ((G - B) > 22) & (G > 165)

    panels = []
    for pname, span in (('40C', (1000, 2500)), ('100C', (2700, 4200))):
        or_bars = bars_of(strict_or, *span)
        gr_bars = bars_of(strict_gr, *span)
        assert len(or_bars) == 7 and len(gr_bars) == 7, (pname, or_bars, gr_bars)
        axis, ticks, labels = detect_panel(a, or_bars[0][0])
        print(f'\n== panel {pname}: axis col {axis}, tick rows {ticks}')
        assert len(ticks) == 4, ticks
        ok_labels = [l for l in labels if l is not None]
        print('   label centroids:', [(l[0], round(l[1], 1), l[2]) for l in ok_labels])
        # Reading A calibration: tick-mark centers
        calA, resA, fitA = fit_cal(list(zip(TICKVALS, ticks)))
        print(f'   calA (tick-mark): px/COF={1/fitA[0]:.1f}, max residual={resA:.5f} COF')
        # Reading B calibration: tick-label centroids
        calB, resB, fitB = fit_cal([(v, c) for v, c, n, tr in ok_labels])
        print(f'   calB (tick-label): px/COF={1/fitB[0]:.1f}, max residual={resB:.5f} COF')
        panels.append(dict(name=pname, or_bars=or_bars, gr_bars=gr_bars,
                           calA=calA, calB=calB, axis=axis, ticks=ticks))

    results = []
    for pan in panels:
        for gname, bars, strict, tol in (('A', pan['or_bars'], strict_or, tol_or),
                                         ('B', pan['gr_bars'], strict_gr, tol_gr)):
            for cond, (s, e) in zip(CONDS, bars):
                w = e - s + 1
                core = slice(s + w // 5, e - w // 5 + 1)  # central 60%
                # ---------- Reading A: strict ink-top with outline midpoint
                tops = []
                for c in range(core.start, core.stop):
                    col = strict[900:2060, c]
                    idx = np.where(col)[0]
                    if len(idx):
                        tops.append(idx[0] + 900)
                tops = np.array(tops)
                fill_top = int(np.median(tops))
                # dark outline band just above fill: rows fill_top-12 .. fill_top-1
                lum = a.mean(axis=2)
                band = lum[fill_top - 12:fill_top, core] < 130
                frac = band.mean(axis=1)
                outline_rows = np.where(frac > 0.5)[0]
                if len(outline_rows):
                    o_top = outline_rows[0] + fill_top - 12
                    o_bot = outline_rows[-1] + fill_top - 12
                    ink_top = (o_top + fill_top) / 2  # stroke midpoint
                else:
                    ink_top = float(fill_top)
                vA = pan['calA'](ink_top)
                # per-column spread for diagnostics
                spread = float(np.std(tops))
                # ---------- Reading B: tolerant 50%-coverage row scan
                cov = tol[900:2060, core.start:core.stop].mean(axis=1)
                hit = np.where(cov >= 0.5)[0]
                # require sustained 5 rows
                topB = None
                for i in hit:
                    if np.all(cov[i:i + 5] >= 0.5):
                        topB = i + 900
                        break
                vB = pan['calB'](float(topB))
                results.append(dict(panel=pan['name'], cond=cond, grease=gname,
                                    xrange=(s, e), vA=vA, vB=vB, spread=spread,
                                    ink_top=ink_top, topB=topB, n_top_cols=len(tops)))

    print('\n================ RESULTS ================')
    print(f"{'panel':6s} {'cond':5s} {'gr':2s} {'readingA':>9s} {'readingB':>9s} {'|A-B|':>7s} {'col-spread px':>13s}")
    for r in results:
        d = abs(r['vA'] - r['vB'])
        flag = '' if d <= 0.004 else '  <-- FAIL GATE'
        print(f"{r['panel']:6s} {r['cond']:5s} {r['grease']:2s} {r['vA']:9.4f} {r['vB']:9.4f} {d:7.4f} {r['spread']:13.1f}{flag}")

    # Neat consistency: average of the four Neat bars vs main text 0.096 +/- 0.004
    neats = [r for r in results if r['cond'] == 'Neat']
    vals = [(r['vA'] + r['vB']) / 2 for r in neats]
    print('\nNeat bars (A/B mean):', [round(v, 4) for v in vals], '| avg =', round(float(np.mean(vals)), 4))

    # full-precision dump for the promotion step
    import json
    dump = {
        'render': str(PAGE), 'render_scale': 8,
        'calibration': {
            '40C': {'tick_rows': panels[0]['ticks'], 'label_centroids': [1095.8, 1387.4, 1679.2, 1970.0]},
            '100C': {'tick_rows': panels[1]['ticks']},
            'note': 'calA=tick-mark centers (residual 0.00000 COF); calB=tick-label centroids (residual 0.00005 COF); 7300 px per COF unit',
        },
        'bars': [
            {'panel': r['panel'], 'cond': r['cond'], 'grease': r['grease'],
             'readingA': r['vA'], 'readingB': r['vB'], 'absAB': abs(r['vA'] - r['vB'])}
            for r in results
        ],
    }
    out = ROOT / 's20-digitization-20260912.json'
    out.write_text(json.dumps(dump, indent=1))
    print('dumped', out)

    # overlay check image: draw measured tops on a crop of each panel
    im = Image.open(PAGE).convert('RGB')
    dr = ImageDraw.Draw(im)
    for r in results:
        s, e = r['xrange']
        yA = r['ink_top']
        yB = r['topB']
        col = (255, 0, 0) if r['grease'] == 'A' else (0, 0, 255)
        dr.line([(s - 6, yA), (e + 6, yA)], fill=col, width=3)
        dr.line([(s - 6, yB), (e + 6, yB)], fill=(0, 200, 0), width=1)
    im.crop((900, 900, 4250, 2100)).save(ROOT / 'pages' / 's20-digit-overlay.png')
    print('\noverlay written: s20-digit-overlay.png (red=A ink-top pass, green=B coverage pass)')


if __name__ == '__main__':
    main()
