"""Independent two-pass pixel-calibrated digitization for the 2026-09-12 Friction curve batches.

Papers:
  A 10.1007/s40544-013-0019-x  (liil-*)      Figs 5(a)/8(a) primary; Figs 4(a)/7(a) cross-checks
  B 10.1007/s40544-019-0283-5  (pilmulti-*)  Fig 5 primary + text anchors (2% IL 0.097, ZDDP ~0.135, PAO4 ~0.16)
  C 10.1007/s40544-019-0324-0  (magilfric-*) Fig 8(c) primary; Fig 6 bar chart cross-check vs text anchors

Protocol (batch-09-ammoniumphos precedent):
  - axis calibration from tick marks (programmatic tick detection, linear fit, residual check)
  - Reading A: strict core-color classification, per-column mean of the tracked trace cluster
  - Reading B: tolerant channel-dominance classification, per-column median of the tracked cluster
  - promotion gate |A-B| <= 0.005; robustness sub-windows; occluded columns linearly interpolated
  - in-plot legend regions excluded; a tracked-cluster filter keeps the trace band only
  - overlay check images written into the per-paper batch folders (verify-*.png)

Run from repo root:  python scripts/digitize-fric-batches-20260912.py
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path('data/literature-expansion-20260912')
TMP = Path('tmp-digit-20260912')

A4 = ROOT / 'fric2-10.1007-s40544-013-0019-x' / 'pages' / 'page-4.png'
A6 = ROOT / 'fric2-10.1007-s40544-013-0019-x' / 'pages' / 'page-6.png'
B4 = ROOT / 'fric-10.1007-s40544-019-0283-5' / 'pages' / 'page-4.png'
C4 = ROOT / 'fric-10.1007-s40544-019-0324-0' / 'pages' / 'page-4.png'
C5 = ROOT / 'fric-10.1007-s40544-019-0324-0' / 'pages' / 'page-5.png'

# ---------------------------------------------------------------- helpers

def load_rgb(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(int)


def longest_run(v):
    best = cur = 0
    for b in v:
        cur = cur + 1 if b else 0
        best = max(best, cur)
    return best


def refine_box(a, approx, pad=9, dark_thresh=130):
    """Refine approximate plot-box edges to the nearest strongest frame lines."""
    xL0, xR0, yT0, yB0 = approx
    g = a.mean(axis=2)
    dark = g < dark_thresh
    def vbest(c0):
        cand = range(max(0, c0 - pad), c0 + pad + 1)
        return max(cand, key=lambda c: longest_run(dark[yT0 - 12:yB0 + 12, c]))
    def hbest(r0):
        cand = range(max(0, r0 - pad), r0 + pad + 1)
        return max(cand, key=lambda r: longest_run(dark[r, xL0 - 12:xR0 + 12]))
    return vbest(xL0), vbest(xR0), hbest(yT0), hbest(yB0)


def group_centers(idx):
    if not len(idx):
        return []
    groups = np.split(np.asarray(idx), np.where(np.diff(idx) > 2)[0] + 1)
    return [float(g[0] + g[-1]) / 2.0 for g in groups if len(g)]


def detect_ticks(a, xL, xR, yT, yB, dark_thresh=140):
    """Tick rows/cols: dark marks that TOUCH the axis and are short (<=5 px group
    height), which rejects axis-label glyph pixels further out."""
    g = a.mean(axis=2)
    dark = g < dark_thresh
    yrows = [y for y in range(yT - 2, yB + 2)
             if dark[y, max(0, xL - 8):xL - 2].any() and dark[y, xL - 3:xL - 1].any()]
    xcols = [x for x in range(xL - 2, xR + 2)
             if dark[yB + 2:min(yB + 9, dark.shape[0]), x].any() and dark[yB + 2:yB + 4, x].any()]
    yc = [c for c in group_centers(yrows)]
    xc = [c for c in group_centers(xcols)]
    # group-height filter: tick groups span <=5 rows/cols
    def short_groups(idx, centers, max_h=5):
        groups = np.split(np.asarray(idx), np.where(np.diff(idx) > 2)[0] + 1) if len(idx) else []
        return [c for c, gp in zip(centers, groups) if len(gp) and (gp[-1] - gp[0] + 1) <= max_h]
    yg = np.split(np.asarray(yrows), np.where(np.diff(yrows) > 2)[0] + 1) if yrows else []
    yc = [c for c, gp in zip(group_centers(yrows), yg) if len(gp) and (gp[-1] - gp[0] + 1) <= 5]
    xg = np.split(np.asarray(xcols), np.where(np.diff(xcols) > 2)[0] + 1) if xcols else []
    xc = [c for c, gp in zip(group_centers(xcols), xg) if len(gp) and (gp[-1] - gp[0] + 1) <= 5]
    return yc, xc


def label_clusters_rows(a, xL, yT, yB, far=(46, 15), dark_thresh=140):
    """Vertical centers of y-axis label text, from a column band left of the ticks."""
    g = a.mean(axis=2)
    dark = g < dark_thresh
    rows = [y for y in range(max(0, yT - 16), min(a.shape[0], yB + 16))
            if dark[y, xL - far[0]:xL - far[1]].any()]
    groups = np.split(np.asarray(rows), np.where(np.diff(rows) > 4)[0] + 1) if rows else []
    return [float(g[0] + g[-1]) / 2.0 for g in groups
            if len(g) and (g[-1] - g[0] + 1) <= 18]


def label_clusters_cols(a, yB, xL, xR, below=(8, 28), dark_thresh=140):
    """Horizontal centers of x-axis label text, from a row band below the axis."""
    g = a.mean(axis=2)
    dark = g < dark_thresh
    cols = [x for x in range(max(0, xL - 20), min(a.shape[1], xR + 24))
            if dark[yB + below[0]:yB + below[1], x].any()]
    groups = np.split(np.asarray(cols), np.where(np.diff(cols) > 6)[0] + 1) if cols else []
    return [float(g[0] + g[-1]) / 2.0 for g in groups
            if len(g) and (g[-1] - g[0] + 1) <= 44]


def fit_axis(pixels, values):
    m, b = np.polyfit(pixels, values, 1)
    res = np.abs(np.polyval([m, b], pixels) - values)
    return float(m), float(b), float(res.max())


def running_median(v, k=21):
    """Centered running median, k odd; edges clamped."""
    n = len(v)
    h = k // 2
    out = np.empty(n)
    for i in range(n):
        lo, hi = max(0, i - h), min(n, i + h + 1)
        out[i] = np.median(v[lo:hi])
    return out


# ---------------------------------------------------------- trace reading

def make_masks(a):
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    return {
        'black':    (a.max(2) < 100),
        'blackT':   (a.max(2) < 150) & ((a.max(2) - a.min(2)) < 45),
        'red':      (r > 150) & (r - g > 80) & (r - b > 80),
        'redT':     (r > 130) & (r - g > 50) & (r - b > 40),
        'blue':     (b - r > 55) & (b - g > 40) & (b > 120),
        'blueT':    (b - r > 22) & (b - g > 22) & (b > 100),
        'teal':     (g > 100) & (g - r > 40) & (b - r > 40) & (np.abs(g - b) < 25),
        'tealT':    (g > 85) & (g - r > 15) & (b - r > 15) & (np.abs(g - b) < 38),
        'pink':     (r > 110) & (r - g > 35) & (b - g > 15),
        'pinkT':    (r > 100) & (r - g > 25) & (b - g > 8),
        'magenta':  (r > 200) & (b > 200) & (g < 120),
        'magentaT': (r - g > 60) & (b - g > 60) & (r > 140) & (b > 140),
        'olive':    (r > 90) & (g > 90) & (b < 70) & (np.abs(r - g) < 45),
        'oliveT':   (r - b > 50) & (g - b > 50) & (r < 180),
    }


def column_clusters(ys, gap=4):
    """Split sorted row indices into contiguous clusters."""
    if len(ys) == 0:
        return []
    groups = np.split(ys, np.where(np.diff(ys) > gap)[0] + 1)
    return groups


def read_trace(a, mask, xL, xR, yT, yB, mode, band=14, exclude=()):
    """Tracked per-column reading of one colored trace.

    1) restrict mask to plot box, drop excluded (legend) rectangles
    2) per column: split matched pixels into contiguous row clusters, pick the
       cluster nearest a smoothed baseline (two iterations), then take the
       per-column mean (mode='mean') or median (mode='median') of that cluster
    Returns (cols, rowvals)."""
    sub = np.zeros_like(mask)
    sub[yT + 1:yB, xL + 1:xR] = mask[yT + 1:yB, xL + 1:xR]
    for (ex1, ey1, ex2, ey2) in exclude:
        sub[ey1:ey2, ex1:ex2] = False
    colmap = {}
    for x in range(xL + 1, xR):
        ys = np.flatnonzero(sub[:, x])
        if len(ys):
            colmap[x] = ys
    if not colmap:
        return np.array([]), np.array([])
    xs = np.asarray(sorted(colmap))
    # initial baseline: global median row of all matched pixels
    allys = np.concatenate([colmap[x] for x in xs])
    base0 = float(np.median(allys))
    pick = {}
    for it in range(2):
        centers = []
        for x in xs:
            clusters = column_clusters(colmap[x])
            cand = [(float(np.mean(c)), c) for c in clusters]
            ref = base0 if it == 0 and not pick else (np.median([pick[x2] for x2 in xs if x2 in pick]) if pick else base0)
            # use smoothed local baseline when available
            if pick:
                local = [pick[x3] for x3 in xs if abs(x3 - x) <= 20 and x3 in pick]
                if local:
                    ref = float(np.median(local))
            best = min(cand, key=lambda t: abs(t[0] - ref))
            if abs(best[0] - ref) <= (60 if it == 0 else band + 8):
                pick[x] = float(np.mean(best[1]) if mode == 'mean' else np.median(best[1]))
                centers.append(pick[x])
            else:
                centers.append(np.nan)
        # rebuild baseline from picks
        good = [x for x in xs if x in pick]
        if not good:
            return np.array([]), np.array([])
        sm = running_median(np.asarray([pick[x] for x in good]), 21)
        for x, s in zip(good, sm):
            base0_x = s
            clusters = column_clusters(colmap[x])
            cand = [(float(np.mean(c)), c) for c in clusters]
            best = min(cand, key=lambda t: abs(t[0] - base0_x))
            if abs(best[0] - base0_x) <= band:
                pick[x] = float(np.mean(best[1]) if mode == 'mean' else np.median(best[1]))
            else:
                pick.pop(x, None)
        if not pick:
            return np.array([]), np.array([])
    # final: recompute per-column stat from tracked clusters
    cols_out, vals_out = [], []
    good = [x for x in xs if x in pick]
    sm = dict(zip(good, running_median(np.asarray([pick[x] for x in good]), 21)))
    for x in good:
        clusters = column_clusters(colmap[x])
        cand = [(float(np.mean(c)), c) for c in clusters]
        best = min(cand, key=lambda t: abs(t[0] - sm[x]))
        if abs(best[0] - sm[x]) <= band:
            vals_out.append(float(np.mean(best[1]) if mode == 'mean' else np.median(best[1])))
            cols_out.append(x)
    return np.asarray(cols_out), np.asarray(vals_out)


def series_in_window(cols, rows, row2v, col2t, t0, t1):
    if len(cols) == 0:
        return float('nan'), float('nan'), 0, 0
    allcols = np.arange(int(cols[0]), int(cols[-1]) + 1)
    series = np.interp(allcols, cols, rows)
    t_of_col = col2t(allcols)
    sel = (t_of_col >= t0) & (t_of_col <= t1)
    vis = sel & np.isin(allcols, cols.astype(int))
    mean_i = float(row2v(series[sel]).mean()) if sel.any() else float('nan')
    mean_v = float(row2v(series[vis]).mean()) if vis.any() else float('nan')
    return mean_i, mean_v, int(vis.sum()), int(sel.sum())


def save_overlay(a, xL, xR, yT, yB, out_png, marks=None, hlines=None, vlines=None,
                 crop_pad=8, zoom=3):
    x1, y1 = max(0, xL - crop_pad), max(0, yT - crop_pad)
    x2, y2 = min(a.shape[1], xR + crop_pad), min(a.shape[0], yB + crop_pad)
    im = Image.fromarray(a[y1:y2, x1:x2].astype(np.uint8))
    im = im.resize((im.width * zoom, im.height * zoom), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    for row, color in (hlines or []):
        yy = (row - y1) * zoom
        d.line([(0, yy), (im.width, yy)], fill=color, width=1)
    for col, color in (vlines or []):
        xx = (col - x1) * zoom
        d.line([(xx, 0), (xx, im.height)], fill=color, width=1)
    for x, y, color in (marks or []):
        xx, yy = (x - x1) * zoom, (y - y1) * zoom
        d.line([(xx - 4, yy), (xx + 4, yy)], fill=color, width=1)
        d.line([(xx, yy - 4), (xx, yy + 4)], fill=color, width=1)
    Path(out_png).parent.mkdir(parents=True, exist_ok=True)
    im.save(out_png)


# ---------------------------------------------------------------- configs
# approx box = (xL, xR, yT, yB); legend = exclusion rects in page coords

PANELS = {
    # Paper A ------------------------------------------------------------
    'A-fig5a': dict(page=A4, box=(244, 572, 1089, 1331),
                    yopts=[(6, 0.28, -0.04), (11, 0.28, -0.02)], xopts=[(7, 0, 300), (13, 0, 150)],
                    legend=[(424, 1092, 570, 1200)],
                    traces={'blue': 'L-C3N3', 'teal': 'L-P3N3'},
                    windows=[(1200, 1800), (600, 1800), (1500, 1800), (400, 1800)],
                    out='fric2-10.1007-s40544-013-0019-x'),
    'A-fig8a': dict(page=A6, box=(243, 570, 1090, 1332),
                    yopts=[(5, 0.24, -0.04), (9, 0.24, -0.02)], xopts=[(7, 0, 300), (13, 0, 150)],
                    legend=[(414, 1104, 568, 1195)],
                    traces={'blue': 'L-C3N3', 'teal': 'L-P3N3'},
                    windows=[(1200, 1800), (600, 1800), (1500, 1800), (400, 1800)],
                    out='fric2-10.1007-s40544-013-0019-x'),
    'A-fig4a': dict(page=A4, box=(249, 568, 705, 941),
                    yopts=[(6, 0.28, -0.04), (11, 0.28, -0.02)], xopts=[(7, 0, 300), (13, 0, 150)],
                    legend=[(408, 702, 560, 845)],
                    traces={'teal': 'L-C3N3-x', 'pink': 'L-P3N3-x'},
                    windows=[(1200, 1800)],
                    out='fric2-10.1007-s40544-013-0019-x'),
    'A-fig7a': dict(page=A6, box=(242, 570, 156, 405),
                    yopts=[(5, 0.24, -0.04), (9, 0.24, -0.02)], xopts=[(7, 0, 300), (13, 0, 150)],
                    legend=[(392, 160, 585, 305)],
                    traces={'teal': 'L-C3N3-x', 'pink': 'L-P3N3-x'},
                    windows=[(1200, 1800)],
                    out='fric2-10.1007-s40544-013-0019-x'),
    # Paper B ------------------------------------------------------------
    'B-fig5': dict(page=B4, box=(189, 552, 1064, 1333),
                   yopts=[(8, 0.22, -0.02), (16, 0.22, -0.01)], xopts=[(7, 0, 300)],
                   legend=[(324, 1066, 560, 1205)],
                   traces={'red': 'IL05', 'blue': 'IL1', 'teal': 'IL15', 'magenta': 'IL2',
                           'olive': 'ZDDP', 'black': 'PAO4'},
                   windows=[(600, 1800), (900, 1800), (1200, 1800), (300, 1800)],
                   out='fric-10.1007-s40544-019-0283-5'),
    # Paper C ------------------------------------------------------------
    'C-fig8c': dict(page=C5, box=(313, 584, 1172, 1372),
                    yopts=[(9, 0.55, -0.05), (17, 0.55, -0.025)], xopts=[(6, 0, 2), (11, 0, 1)],
                    legend=[(316, 1176, 600, 1262)],
                    traces={'black': 'MIL100N'},
                    windows=[(5, 10), (4, 10), (6, 10), (7, 10), (0, 10)],
                    out='fric-10.1007-s40544-019-0324-0'),
}


def read_panel(name, cfg, results):
    a = load_rgb(str(cfg['page']))
    xL, xR, yT, yB = refine_box(a, cfg['box'])
    yt, xt = detect_ticks(a, xL, xR, yT, yB)
    def match_ticks(ticks, opts):
        ticks = np.asarray(ticks)
        for count, first, step in opts:
            if len(ticks) < 2:
                break
            base = (ticks[-1] - ticks[0]) / (count - 1)
            best = None
            for s_px in np.linspace(base * 0.70, base * 1.05, 140):
                expected = ticks[0] + s_px * np.arange(count)
                tol = max(1.6, 0.04 * s_px)
                inl = [t for t in ticks if np.min(np.abs(expected - t)) < tol]
                if len(inl) != count:
                    continue
                # every expected position must be covered, residuals minimal
                devs = [min(abs(expected[k] - t) for t in ticks) for k in range(count)]
                rms = float(np.sqrt(np.mean(np.square(devs))))
                if best is None or rms < best[0]:
                    best = (rms, expected)
            if best is not None:
                return best[1], first + step * np.arange(count)
        return None, None

    # primary calibration: axis LABEL text centers (semantic anchor, immune to
    # tick-vs-corner phase errors); detected ticks serve as the cross-check
    ylab = label_clusters_rows(a, xL, yT, yB)
    xlab = label_clusters_cols(a, yB, xL, xR)
    # primary calibration: axis LABEL text centers (semantic anchor, immune to
    # tick-vs-corner phase errors); detected ticks serve as the cross-check.
    # Fallback: if label clustering drops some labels but every found label sits
    # within 2.5 px of a detected tick and the tick count matches, use the ticks.
    def calib(centers, ticks, opts, kind):
        opt = next((o for o in opts if o[0] == len(centers)), None)
        src = 'labels'
        if opt is not None:
            vals = opt[1] + opt[2] * np.arange(len(centers))
            m, b, r = fit_axis(np.asarray(centers), vals)
        else:
            ticks_f, vals = match_ticks(ticks, opts)
            if ticks_f is None:
                raise AssertionError(f'{name}: unexpected {kind} label count {len(centers)} '
                                     f'({[round(v, 1) for v in centers]}) and no tick match')
            m, b, r = fit_axis(ticks_f, vals)
            src = 'ticks'
            dev = [min(abs(t - c) for t in ticks_f) for c in centers]
            assert max(dev) < 2.5, f'{name}: {kind} labels disagree with ticks (max {max(dev):.1f}px)'
        return m, b, r, vals, src

    my, by, ry, yvals, ysrc = calib(ylab, yt, cfg['yopts'], 'y')
    mx, bx, rx, xvals, xsrc = calib(xlab, xt, cfg['xopts'], 'x')
    ydev = [min(abs(t - c) for t in yt) for c in ylab] if yt else []
    xdev = [min(abs(t - c) for t in xt) for c in xlab] if xt else []
    print(f'\n=== {name}: box x[{xL},{xR}] y[{yT},{yB}]')
    print(f'   ylabels({len(ylab)})={[round(v, 1) for v in ylab]} -> {yvals[0]}..{yvals[-1]}; '
          f'tick dev max {max(ydev) if ydev else float("nan"):.1f}px')
    print(f'   xlabels({len(xlab)})={[round(v, 1) for v in xlab]} -> {xvals[0]}..{xvals[-1]}; '
          f'tick dev max {max(xdev) if xdev else float("nan"):.1f}px')
    print(f'   y: val={my:.6f}*row+{by:.4f} (label residual {ry:.5f} cof)  '
          f'x: t={mx:.4f}*col+{bx:.2f} (label residual {rx:.2f} s)')
    assert ry < 0.0006 and rx < 8, f'label fit residual too large for {name}'
    assert max(ydev, default=0) < 6 and max(xdev, default=0) < 8, \
        f'{name}: label/tick disagreement'
    row2v = lambda r: my * np.asarray(r) + by
    col2t = lambda c: mx * np.asarray(c) + bx
    masks = make_masks(a)
    marks = [(xL - 5, y, (255, 0, 0)) for y in yt] + [(x, yB + 5, (0, 160, 0)) for x in xt]
    save_overlay(a, xL, xR, yT, yB, str(TMP / f'ticks-{name}.png'), marks=marks)
    for mkey, tname in cfg['traces'].items():
        tolkey = mkey + 'T' if mkey + 'T' in masks else mkey
        cA, rA = read_trace(a, masks[mkey], xL, xR, yT, yB, 'mean', exclude=cfg['legend'])
        cB, rB = read_trace(a, masks[tolkey], xL, xR, yT, yB, 'median', exclude=cfg['legend'])
        if len(cA) == 0 or len(cB) == 0:
            print(f'   [{tname}] {mkey}: EMPTY (strict {len(cA)}, tolerant {len(cB)})')
            continue
        print(f'   [{tname}] {mkey}: {len(cA)} cols strict / {len(cB)} tolerant')
        for (t0, t1) in cfg['windows']:
            mA, vA, nA, ntot = series_in_window(cA, rA, row2v, col2t, t0, t1)
            mB, vB, nB, _ = series_in_window(cB, rB, row2v, col2t, t0, t1)
            print(f'     win {t0:>4}-{t1:<4}: A={mA:.4f} (vis {nA}/{ntot})  '
                  f'B={mB:.4f} (vis {nB}/{ntot})  |A-B|={abs(mA - mB):.4f}')
            results[(name, tname, t0, t1)] = (mA, mB, nA, ntot)
        t0, t1 = cfg['windows'][0]
        mA, *_ = series_in_window(cA, rA, row2v, col2t, t0, t1)
        mB, *_ = series_in_window(cB, rB, row2v, col2t, t0, t1)
        base = ROOT / cfg['out'] / f'verify-{name}-{tname}'
        save_overlay(a, xL, xR, yT, yB, str(base) + '-A.png', hlines=[((mA - by) / my, (255, 0, 0))])
        save_overlay(a, xL, xR, yT, yB, str(base) + '-B.png', hlines=[((mB - by) / my, (0, 0, 255))])


# ----------------------------------------------------------- Fig 6 bars

def read_fig6_bars():
    a = load_rgb(str(C4))
    xL, xR, yT, yB = refine_box(a, (710, 1085, 138, 384))
    ylab = label_clusters_rows(a, xL, yT, yB, far=(30, 14))
    assert len(ylab) == 7, f'fig6 ylabel count {len(ylab)} unexpected: {ylab}'
    yvals = 0.6 + -0.1 * np.arange(7)
    my, by, ry = fit_axis(np.asarray(ylab), yvals)
    print(f'\n=== C-fig6: box x[{xL},{xR}] y[{yT},{yB}] ylabels({len(ylab)})={[round(v,1) for v in ylab]}')
    print(f'   y: val={my:.6f}*row+{by:.4f} (label residual {ry:.4f} cof)')
    row2v = lambda r: my * np.asarray(r) + by
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    dark = a.max(2) < 120
    hatch = {'MIL': (b - r > 40) & (b - g > 30) & (b > 110),
             'MF': (r - g > 60) & (r - b > 60) & (r > 140)}
    # bar cells: hatch fill presence just above the bottom axis; the 16 bars are
    # contiguous, in two 8-bar blocks (100 N then 200 N), alternating MIL/MF
    lo, hi = int(yB) - 35, int(yB) - 2
    cm = hatch['MIL'][lo:hi].sum(0)
    cf = hatch['MF'][lo:hi].sum(0)
    xs = np.flatnonzero((cm > 5) | (cf > 5))
    groups = np.split(xs, np.where(np.diff(xs) > 3)[0] + 1)
    blocks = [(int(g[0]), int(g[-1])) for g in groups if len(g) > 50]
    assert len(blocks) == 2, f'expected 2 bar blocks, got {blocks}'
    bars = []
    for (x1, x2) in blocks:
        w = (x2 - x1 + 1) / 8.0
        for k in range(8):
            bars.append((x1 + k * w, x1 + (k + 1) * w))
    print(f'   bar cells: ' + ', '.join(f'[{a1:.0f}-{b1:.0f}]' for a1, b1 in bars))
    out = {}
    marks = []
    for label, m in hatch.items():
        vals = []
        for idx, (fx1, fx2) in enumerate(bars):
            x1, x2 = int(round(fx1)), int(round(fx2))
            is_this = m[lo:hi, x1 + 2:x2 - 1].sum() > (14 * (hi - lo) * 0.25)
            if not is_this:
                continue
            # bar top = highest row from which the colored body (fill + borders)
            # continues unbroken down to the axis; error-bar caps and legend
            # swatches are separated from the body by white rows -> excluded
            counts = m[yT + 2:yB - 4, x1 + 1:x2].sum(1)
            ok = counts >= 3
            # first row after the last row that breaks the body continuity
            last_false = -1
            for y, o in enumerate(ok):
                if not o:
                    last_false = y
            start = last_false + 1
            top = yT + 2 + start if start < len(ok) - 5 else None
            if top is None:
                continue
            v = float(row2v(top + 1))
            vals.append((idx, top, v))
            marks.append((int((x1 + x2) / 2), top, (0, 200, 0) if label == 'MIL' else (255, 0, 255)))
        out[label] = vals
        print(f'   {label}: ' + ', '.join(f'bar{idx + 1} top={top} cof={v:.4f}' for idx, top, v in vals))
    save_overlay(a, xL, xR, yT - 4, yB + 30, str(TMP / 'bars-fig6.png'), marks=marks, zoom=2)
    return out


def main():
    results = {}
    for name, cfg in PANELS.items():
        read_panel(name, cfg, results)
    read_fig6_bars()
    print('\ndone')


if __name__ == '__main__':
    main()
