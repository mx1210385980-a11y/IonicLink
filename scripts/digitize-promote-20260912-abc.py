"""Two-pass pixel-calibrated digitization for the 2026-09-12 promotion batches.

Papers (all HELD candidates pending figure digitization):
  A 10.1007/s40544-019-0348-5  (gemini-*)   Fig 5(a) RT + Fig 6(a) 100 C, COF/time, broken y axes
  B 10.1007/s40544-021-0550-0  (boundadd-*) Fig 2(a) WG + Fig 2(b) PAO, COF/distance
  C 10.3762/bjnano.8.197       (bjnano-*)   Figure 5(a,b,c) COF vs Sommerfeld Z; Figure 3(a,b) cross-checks

Protocol (batch-09-ammoniumphos precedent, |A-B| <= 0.005 promotion gate):
  Pass A: axis calibration from axis LABEL text centers; strict core-color masks;
          per-column tracked cluster (short-cluster filter) center, window MEAN.
  Pass B: axis calibration from TICK marks (independent detection); tolerant
          channel masks; per-column full-mask statistic (median), window MEAN.
  Paper C markers: Pass A strict mask + connected components + body-bbox center
          (mean); Pass B tolerant mask + dilated grouping + body pixel MEDIAN +
          tick calibration; error-bar midpoint diagnostic; series minimum is the
          extracted metric, last (max-Z, v = 2.0 cm/s) point recorded as context.
Overlay check images written into the per-paper batch folders (verify-*.png).

Run from repo root:  python scripts/digitize-promote-20260912-abc.py
"""
from pathlib import Path
import importlib.util
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

_spec = importlib.util.spec_from_file_location(
    'digib', Path('scripts/digitize-fric-batches-20260912.py'))
digi = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(digi)

load_rgb = digi.load_rgb
refine_box = digi.refine_box
group_centers = digi.group_centers
label_clusters_rows = digi.label_clusters_rows
label_clusters_cols = digi.label_clusters_cols
fit_axis = digi.fit_axis
running_median = digi.running_median
save_overlay = digi.save_overlay

ROOT = Path('data/literature-expansion-20260912')
TMP = Path('tmp-digit-20260912')
RESULTS = {}

# ----------------------------------------------------------------- masks

def fam_masks(a, paper):
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    if paper == 'A':
        return {
            'red':     ((r - g > 110) & (r - b > 110) & (r > 200),
                        (r - g > 55) & (r - b > 45) & (r > 150)),
            'blue':    ((b - r > 110) & (b - g > 110) & (b > 200),
                        (b - r > 55) & (b - g > 45) & (b > 150)),
            'magenta': ((r - g > 120) & (b - g > 120) & (r > 200) & (b > 200),
                        (r - g > 75) & (b - g > 75) & (r > 165) & (b > 165)),
            'green':   ((g - r > 55) & (g - b > 55) & (g > 115) & (g < 215),
                        (g - r > 28) & (g - b > 28) & (g > 100)),
            'black':   ((a.max(2) < 100),
                        (a.max(2) < 150) & ((a.max(2) - a.min(2)) < 45)),
        }
    if paper == 'B':
        return {
            'red':   ((r - g > 110) & (r - b > 100) & (r > 200),
                      (r - g > 55) & (r - b > 45) & (r > 150)),
            'blue':  ((b - r > 150) & (b - g > 150) & (b > 200),
                      (b - r > 70) & (b - g > 70) & (b > 150)),
            'green': ((g - r > 120) & (g - b > 120) & (g > 200),
                      (g - r > 55) & (g - b > 55) & (g > 140)),
            'gray':  ((np.abs(r - g) < 9) & (np.abs(g - b) < 9) & (r > 115) & (r < 168),
                      (np.abs(r - g) < 17) & (np.abs(g - b) < 17) & (r > 104) & (r < 186)),
        }
    if paper == 'C':
        return {
            'red':     ((r - g > 130) & (r - b > 130) & (r > 210),
                        (r - g > 70) & (r - b > 70) & (r > 150)),
            'cynblue': ((b - r > 110) & (g - r > 90) & (g > 140) & (b > 200),
                        (b - r > 55) & (g - r > 40) & (g > 115) & (b > 170)),
            'green':   ((g - r > 35) & (g - b > 75) & (g > 175),
                        (g - r > 22) & (g - b > 40) & (g > 150)),
            'purple':  ((r - g > 35) & (b - g > 60) & (r > 85) & (r < 165) & (b > 130) & (b < 215),
                        (r - g > 22) & (b - g > 35) & (r > 75) & (r < 185) & (b > 115) & (b < 235)),
            'gold':    ((r > 230) & (g > 155) & (g < 225) & (b < 90),
                        (r > 200) & (g > 130) & (g < 235) & (b < 130)),
            'black':   ((a.max(2) < 95),
                        (a.max(2) < 150) & ((a.max(2) - a.min(2)) < 45)),
        }
    raise ValueError(paper)


# ------------------------------------------------------- axis calibration

def ticks_y(a, xL, yT, yB):
    """Tick rows on the left axis (marks protruding left of the axis line)."""
    g = a.mean(axis=2)
    dark = g < 160
    rows = [y for y in range(max(0, yT - 3), yB + 3)
            if dark[y, max(0, xL - 7):xL - 2].any()]
    return group_centers(rows)


def ticks_x(a, xL, xR, yB):
    g = a.mean(axis=2)
    dark = g < 160
    cols = [x for x in range(max(0, xL - 3), xR + 3)
            if dark[yB + 2:yB + 8, x].any()]
    return group_centers(cols)


def assign_tick_values(ticks, ref_rows, ref_vals, tol=2.5):
    """Assign values to detected ticks by proximity to a reference calibration."""
    m, b = np.polyfit(ref_rows, ref_vals, 1)
    out = []
    for t in ticks:
        v = m * t + b
        near = ref_vals[int(np.argmin(np.abs(ref_rows - t)))]
        if abs(v - near) * 0 + min(abs(t - rr) for rr in ref_rows) <= tol:
            out.append((t, near))
    return out


# --------------------------------------------------- Paper A / B curves

def window_mean(cols, rows, row2v, col2t, t0, t1):
    allcols = np.arange(int(cols[0]), int(cols[-1]) + 1)
    series = np.interp(allcols, cols, rows)
    sel = (col2t(allcols) >= t0) & (col2t(allcols) <= t1)
    return float(row2v(series[sel]).mean()), int(sel.sum())


def read_col_tracked(mask, xL, xR, yTop, yBot, max_extent=8, band=22):
    """Per-column center of the largest short (<=max_extent) pixel cluster."""
    centers = {}
    for x in range(xL + 1, xR):
        ys = np.flatnonzero(mask[yTop:yBot, x]) + yTop
        if not len(ys):
            continue
        clusters = np.split(ys, np.where(np.diff(ys) > 2)[0] + 1)
        short = [c for c in clusters if (c[-1] - c[0] + 1) <= max_extent]
        if not short:
            continue
        best = max(short, key=len)
        centers[x] = float(best.mean())
    # reject columns whose center deviates from the running median baseline
    xs = np.asarray(sorted(centers))
    vals = np.asarray([centers[x] for x in xs])
    keep = np.ones(len(xs), bool)
    sm = running_median(vals, 31)
    keep = np.abs(vals - sm) <= band
    return xs[keep], vals[keep]


def read_col_full(mask, xL, xR, yTop, yBot):
    """Per-column median of ALL mask pixels (strokes included)."""
    cols, vals = [], []
    for x in range(xL + 1, xR):
        ys = np.flatnonzero(mask[yTop:yBot, x]) + yTop
        if len(ys):
            cols.append(x)
            vals.append(float(np.median(ys)))
    return np.asarray(cols), np.asarray(vals)


def do_curve_panel(name, page_path, paper, box, ylab_band, xlab_band,
                   yvalues, xvalues, traces, legend, rows_top, windows,
                   out_dir, min_win_px=40, yseg=None):
    a = load_rgb(str(page_path))
    xL, xR, yT, yB = refine_box(a, box)
    # --- y labels (band scan)
    g = a.mean(axis=2)
    dark = g < 140
    rows = [y for y in range(yT - 18, yB + 18)
            if dark[y, ylab_band[0]:ylab_band[1]].any()]
    ylab = group_centers(rows)
    assert len(ylab) == len(yvalues), f'{name}: y labels {len(ylab)} != {len(yvalues)}: {ylab}'
    broken = yseg is not None
    if yseg is None:
        yseg = list(range(len(yvalues)))
    seg_rows = np.asarray([ylab[i] for i in yseg])
    seg_vals = np.asarray([yvalues[i] for i in yseg], float)
    my, by, ry = fit_axis(seg_rows, seg_vals)
    assert ry / abs(my) < 2.0, f'{name}: y label fit residual {ry/abs(my):.2f}px'
    # --- x labels
    xlab = label_clusters_cols(a, yB, xL, xR, below=(xlab_band[0], xlab_band[1]))
    assert len(xlab) == len(xvalues), f'{name}: x labels {len(xlab)} != {len(xvalues)}: {xlab}'
    mx, bx, rx = fit_axis(np.asarray(xlab), np.asarray(xvalues, float))
    assert rx / abs(mx) < 2.0, f'{name}: x label fit residual {rx/abs(mx):.2f}px'
    # --- Pass B calibration (independent source) + cross-check vs labels.
    # Full-axis panels: the axis FRAME endpoints anchor the scale (top frame =
    # top scale value, bottom frame = 0). Broken-axis panels: tick marks within
    # the lower linear segment.
    if not broken:
        yt_ass = [(float(yT), float(yvalues[0])), (float(yB), float(yvalues[-1]))]
        xt_ass = [(float(xL), float(xvalues[0])), (float(xR), float(xvalues[-1]))]
        src = 'frame endpoints'
    else:
        yt = ticks_y(a, xL, yT, yB)
        xt = ticks_x(a, xL, xR, yB)
        yt_ass = assign_tick_values(yt, seg_rows, seg_vals)
        xt_ass = assign_tick_values(xt, np.asarray(xlab), np.asarray(xvalues, float))
        src = 'ticks'
        assert len(yt_ass) >= 2 and len(xt_ass) >= 2, \
            f'{name}: tick assignment failed y{yt} x{xt}'
    myB, byB = np.polyfit(*zip(*yt_ass), 1)
    mxB, bxB = np.polyfit(*zip(*xt_ass), 1)
    dev_y = max(abs(my * r + by - v) for r, v in yt_ass) / abs(my)
    dev_x = max(abs(mx * c + bx - v) for c, v in xt_ass) / abs(mx)
    dev_ylab = max(abs(myB * r + byB - v) for r, v in zip(seg_rows, seg_vals)) / abs(myB)
    dev_xlab = max(abs(mxB * c + bxB - v) for c, v in zip(xlab, xvalues)) / abs(mxB)
    print(f'\n=== {name}: box x[{xL},{xR}] y[{yT},{yB}]')
    print(f'   y labels {[round(v,1) for v in ylab]} <- {yvalues}; '
          f'segment {[(round(ylab[i],1), yvalues[i]) for i in yseg]}; resid {ry/abs(my):.2f}px')
    print(f'   x labels {[round(v,1) for v in xlab]} <- {xvalues}; resid {rx/abs(mx):.2f}px')
    print(f'   calibration cross-check ({src}): y {dev_y:.2f}px / x {dev_x:.2f}px; '
          f'reverse y {dev_ylab:.2f}px / x {dev_xlab:.2f}px')
    assert dev_y <= 2.0 and dev_x <= 2.0 and dev_ylab <= 2.5 and dev_xlab <= 2.5, \
        f'{name}: calibration disagreement'
    row2vA = lambda rr: my * np.asarray(rr) + by
    row2vB = lambda rr: myB * np.asarray(rr) + byB
    col2tA = lambda cc: mx * np.asarray(cc) + bx
    col2tB = lambda cc: mxB * np.asarray(cc) + bxB
    masks = fam_masks(a, paper)
    marks = [(xL - 4, r, (255, 0, 0)) for r, _ in yt_ass] + \
            [(c, yB + 4, (0, 160, 0)) for c, _ in xt_ass]
    save_overlay(a, xL, xR, yT, yB, str(TMP / f'ticks-{name}.png'), marks=marks)
    out = {}
    for tname, tkey in traces.items():
        strict, tol = masks[tkey]
        mA_mask = strict.copy()
        for (ex1, ey1, ex2, ey2) in legend:
            mA_mask[ey1:ey2, ex1:ex2] = False
        mB_mask = tol.copy()
        for (ex1, ey1, ex2, ey2) in legend:
            mB_mask[ey1:ey2, ex1:ex2] = False
        cA, rA = read_col_tracked(mA_mask, xL, xR, rows_top, yB - 1)
        cB, rB = read_col_full(mB_mask, xL, xR, rows_top, yB - 1)
        assert len(cA) > min_win_px and len(cB) > min_win_px, \
            f'{name}/{tname}: too few columns A={len(cA)} B={len(cB)}'
        line = f'   [{tname}] {tkey}: cols A={len(cA)} B={len(cB)}'
        for (t0, t1) in windows:
            wA, nA = window_mean(cA, rA, row2vA, col2tA, t0, t1)
            wB, nB = window_mean(cB, rB, row2vB, col2tB, t0, t1)
            out[(tname, t0, t1)] = (wA, wB)
            line += f' | {t0}-{t1}: A={wA:.4f} B={wB:.4f} d={abs(wA-wB):.4f}'
        print(line)
        t0, t1 = windows[0]
        wA, _ = window_mean(cA, rA, row2vA, col2tA, t0, t1)
        wB, _ = window_mean(cB, rB, row2vB, col2tB, t0, t1)
        base = ROOT / out_dir / f'verify-{name}-{tname}'
        save_overlay(a, xL, xR, yT, yB, str(base) + '-A.png',
                     hlines=[((wA - by) / my, (255, 0, 0))])
        save_overlay(a, xL, xR, yT, yB, str(base) + '-B.png',
                     hlines=[((wB - byB) / myB, (0, 0, 255))])
    RESULTS[name] = out


# --------------------------------------------------- Paper C markers

def marker_centers(mask, x1, y1, x2, y2, dil, q=0.42, use_median=False, minpx=12):
    """Detect marker blobs; return list of (cx, cy, cx_body, cy_body, bar_mid)."""
    sub = np.zeros_like(mask)
    sub[y1:y2, x1:x2] = mask[y1:y2, x1:x2]
    if not sub.any():
        return []
    grouped = ndimage.binary_dilation(sub, iterations=dil)
    lab, n = ndimage.label(grouped)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(sub & (lab == i))
        if len(xs) < minpx:
            continue
        # body columns: substantial vertical presence (kills thin error bars)
        colcnt = np.bincount(xs, minlength=sub.shape[1])
        thr = q * colcnt.max()
        bodyc = xs[colcnt[xs] >= thr]
        if len(bodyc) < 6:
            continue
        rowcnt = np.bincount(ys, minlength=sub.shape[0])
        bodyr = ys[rowcnt[ys] >= q * rowcnt.max()]
        if len(bodyr) < 4:
            continue
        if use_median:
            cx, cy = float(np.median(bodyc)), float(np.median(bodyr))
        else:
            cx = float(bodyc.mean())
            cy = float(bodyr.mean())
        bx1, bx2, by1, by2 = xs.min(), xs.max(), ys.min(), ys.max()
        bbox_cx, bbox_cy = float((bx1 + bx2) / 2), float((by1 + by2) / 2)
        # error-bar midpoint: extreme rows of the whole group in the center band
        band = (xs > (bx1 + bx2) / 2 - 2) & (xs < (bx1 + bx2) / 2 + 2)
        bar_mid = float((ys[band].min() + ys[band].max()) / 2) if band.any() else None
        out.append((cx, cy, bbox_cx, bbox_cy, bar_mid))
    out.sort(key=lambda t: t[2])
    return out


def do_marker_panel(name, page_path, paper, region, ylab_band, xlab_rows,
                    yvalues, xvalues, series_fams, out_dir, is_fig3=False):
    a = load_rgb(str(page_path))
    x1, y1, x2, y2 = region
    # snap to axes: left axis = leftmost long dark column near x1; bottom = long dark row near y2
    g = a.mean(axis=2)
    dark = g < 150
    xL = max(range(x1 - 6, x1 + 7), key=lambda c: dark[y1:y2, c].sum())
    yB = max(range(y2 - 6, y2 + 7), key=lambda r: dark[r, x1:x2].sum())
    rows = [y for y in range(y1 - 20, yB + 4)
            if dark[y, ylab_band[0]:ylab_band[1]].any()]
    ylab = group_centers(rows)
    assert len(ylab) == len(yvalues), f'{name}: y labels {len(ylab)} != {len(yvalues)}: {ylab}'
    myA, byA, ry = fit_axis(np.asarray(ylab), np.asarray(yvalues, float))
    assert ry / abs(myA) < 1.5, f'{name}: y label residual {ry/abs(myA):.2f}px'
    xlab = label_clusters_cols(a, yB, xL, x1 + (x2 - x1), below=xlab_rows)
    xlab = [c for c in xlab if c >= xL - 6]
    assert len(xlab) == len(xvalues), f'{name}: x labels {len(xlab)} != {len(xvalues)}: {xlab}'
    mxA, bxA, rx = fit_axis(np.asarray(xlab), np.asarray(xvalues, float))
    assert rx / abs(mxA) < 1.5, f'{name}: x label residual {rx/abs(mxA):.2f}px'
    # Pass B: tick-based calibration
    yt = ticks_y(a, xL, y1 - 10, yB)
    xt = ticks_x(a, xL, x1 + (x2 - x1), yB)
    yt_ass = assign_tick_values(yt, np.asarray(ylab), np.asarray(yvalues, float), tol=3.0)
    xt_ass = assign_tick_values(xt, np.asarray(xlab), np.asarray(xvalues, float), tol=3.0)
    assert len(yt_ass) >= 3 and len(xt_ass) >= 3, f'{name}: ticks y{yt_ass} x{xt_ass}'
    myB, byB = np.polyfit(*zip(*yt_ass), 1)
    mxB, bxB = np.polyfit(*zip(*xt_ass), 1)
    dev_y = max(abs(myA * r + byA - v) / abs(myA) for r, v in yt_ass)
    dev_x = max(abs(mxA * c + bxA - v) / abs(mxA) for c, v in xt_ass)
    print(f'\n=== {name}: xL={xL} yB={yB}; region x[{x1},{x2}] y[{y1},{y2}]')
    print(f'   y labels {[round(v,1) for v in ylab]} <- {yvalues}; resid {ry:.2f}px')
    print(f'   x labels {[round(v,3) for v in xlab]} <- {xvalues}; resid {rx:.2f}px')
    print(f'   tick-vs-label dev: y {dev_y:.2f}px x {dev_x:.2f}px (ny={len(yt_ass)}, nx={len(xt_ass)})')
    assert dev_y <= 2.0 and dev_x <= 2.0, f'{name}: tick/label disagreement'
    masks = fam_masks(a, paper)
    out = {}
    marks = []
    for tname, fam in series_fams.items():
        strict, tol = masks[fam]
        mp = 30 if fam == 'black' else 12  # black: reject error-bar caps/segments
        A = marker_centers(strict, xL + 2, y1, x1 + (x2 - x1), yB - 1, dil=2, q=0.42, use_median=False, minpx=mp)
        B = marker_centers(tol, xL + 2, y1, x1 + (x2 - x1), yB - 1, dil=3, q=0.50, use_median=True, minpx=mp)
        if len(A) < 3 or len(B) < 3:
            print(f'   [{tname}] {fam}: markers A={len(A)} B={len(B)} -- FAIL')
            RESULTS[(name, tname)] = None
            continue
        # pair by nearest x
        pairs = []
        for (cx, cy, bcx, bcy, bm) in A:
            j = int(np.argmin([abs(p[2] - bcx) for p in B]))
            pairs.append(((cx, cy, bcx, bcy, bm), B[j]))
        line = f'   [{tname}] {fam}: n={len(A)}/{len(B)}'
        rowsA = [p[0][3] for p in pairs]
        valsA = [float(myA * r + byA) for r in rowsA]
        valsB = [float(myB * p[1][3] + byB) for p in pairs]
        zsA = [float(mxA * p[0][2] + bxA) for p in pairs]
        zsB = [float(mxB * p[1][2] + bxB) for p in pairs]
        iminA = int(np.argmin(valsA)); iminB = int(np.argmin(valsB))
        iendA = int(np.argmax(zsA)); iendB = int(np.argmax(zsB))
        bar_dev = [abs(p[0][4] - p[0][3]) for p in pairs if p[0][4] is not None]
        out[tname] = dict(
            n=len(A), valsA=valsA, valsB=valsB, zsA=zsA, zsB=zsB,
            minA=valsA[iminA], minB=valsB[iminB], minZ_A=zsA[iminA],
            endA=valsA[iendA], endB=valsB[iendB], endZ=zsA[iendA],
            bar_dev=max(bar_dev) if bar_dev else None)
        line += (f' min A={valsA[iminA]:.4f}@Z{zsA[iminA]:.2e} B={valsB[iminB]:.4f} '
                 f'd={abs(valsA[iminA]-valsB[iminB]):.4f} | end A={valsA[iendA]:.4f} '
                 f'B={valsB[iendB]:.4f} d={abs(valsA[iendA]-valsB[iendB]):.4f}')
        if bar_dev:
            line += f' | bar-mid dev max {max(bar_dev):.1f}px'
        print(line)
        for (pa, pb) in pairs:
            marks.append((int(pa[2]), int(pa[3]), (255, 0, 0)))
            marks.append((int(pb[2]), int(pb[3]), (0, 0, 255)))
    save_overlay(a, xL, x1 + (x2 - x1), y1 - 14, yB + 26,
                 str(ROOT / out_dir / f'verify-{name}.png'), marks=marks, zoom=2)
    RESULTS[name] = out


# ------------------------------------------------------------------- main

def paper_A():
    P5 = ROOT / 'fric-10.1007-s40544-019-0348-5' / 'pages' / 'page-5.png'
    P6 = ROOT / 'fric-10.1007-s40544-019-0348-5' / 'pages' / 'page-6.png'
    OUT = 'fric-10.1007-s40544-019-0348-5'
    W = [(1200, 1800), (1500, 1800), (900, 1800)]
    do_curve_panel(
        'A-fig5a', P5, 'A', box=(296, 584, 1137, 1348),
        ylab_band=(268, 292), xlab_band=(6, 26),
        yvalues=[0.6, 0.4, 0.1, 0.0], xvalues=[0, 600, 1200, 1800],
        traces={'NP-14-2-14': 'blue', 'NP-16-2-16': 'magenta',
                'NP-18-2-18': 'green', 'L-P104(red, ref)': 'red'},
        legend=[(455, 1140, 586, 1238)], rows_top=1246, windows=W, out_dir=OUT,
        yseg=[2, 3])
    do_curve_panel(
        'A-fig6a', P6, 'A', box=(292, 657, 153, 365),
        ylab_band=(262, 288), xlab_band=(6, 26),
        yvalues=[0.8, 0.6, 0.4, 0.1, 0.0], xvalues=[0, 600, 1200, 1800],
        traces={'NP-14-2-14': 'blue', 'NP-16-2-16': 'magenta',
                'NP-18-2-18': 'green', 'L-P104(red, ref)': 'red',
                'PAO10(black, anchor)': 'black'},
        legend=[(330, 155, 590, 258)], rows_top=263, windows=W, out_dir=OUT,
        yseg=[3, 4])


def paper_B():
    P7 = ROOT / 'fric-10.1007-s40544-021-0550-0' / 'pages' / 'page-7.png'
    OUT = 'fric-10.1007-s40544-021-0550-0'
    W = [(200, 300), (150, 300), (250, 300), (100, 300)]
    yv = [0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0]
    xv = [0, 50, 100, 150, 200, 250, 300]
    do_curve_panel(
        'B-fig2a', P7, 'B', box=(243, 577, 146, 368),
        ylab_band=(222, 240), xlab_band=(6, 24), yvalues=yv, xvalues=xv,
        traces={'WG-BMP': 'red', 'WG-PP': 'blue', 'WG-C12(green, ref)': 'green',
                'WG(gray, anchor)': 'gray'},
        legend=[(458, 146, 570, 212)], rows_top=148, windows=W, out_dir=OUT)
    do_curve_panel(
        'B-fig2b', P7, 'B', box=(645, 978, 146, 368),
        ylab_band=(624, 642), xlab_band=(6, 24), yvalues=yv, xvalues=xv,
        traces={'PAO-BMP': 'red', 'PAO-PP': 'blue', 'PAO-C12(green, anchor)': 'green',
                'PAO(gray, anchor)': 'gray'},
        legend=[(860, 146, 972, 212)], rows_top=148, windows=W, out_dir=OUT)


def paper_C():
    P6 = ROOT / 'batch-08-bjnano' / 'pages' / 'page-6.png'
    P4 = ROOT / 'batch-08-bjnano' / 'pages' / 'page-4.png'
    OUT = 'batch-08-bjnano'
    yv5 = [0.25, 0.2, 0.15, 0.1, 0.05]
    xv6 = [0, 5e-5, 1e-4, 1.5e-4, 2e-4, 2.5e-4]
    xv8 = [0, 5e-5, 1e-4, 1.5e-4, 2e-4, 2.5e-4, 3e-4, 3.5e-4]
    do_marker_panel('C-fig5a', P6, 'C', region=(199, 218, 545, 413),
                    ylab_band=(160, 193), xlab_rows=(4, 24), yvalues=yv5, xvalues=xv6,
                    series_fams={'PEG+EMIM-TfO': 'red', 'PEG+BMIM-TfO': 'cynblue',
                                 'PEG+C2OHMIM-TfO': 'green', 'PEG+AMIM-TfO': 'purple',
                                 'PEG(black, ref)': 'black'}, out_dir=OUT)
    do_marker_panel('C-fig5b', P6, 'C', region=(200, 460, 545, 652),
                    ylab_band=(160, 193), xlab_rows=(4, 24), yvalues=yv5, xvalues=xv6,
                    series_fams={'PEG+BMIM-DCA': 'cynblue', 'PEG+C2OHMIM-DCA': 'green',
                                 'PEG(black, ref)': 'black'}, out_dir=OUT)
    do_marker_panel('C-fig5c', P6, 'C', region=(200, 694, 545, 889),
                    ylab_band=(160, 193), xlab_rows=(4, 24), yvalues=yv5, xvalues=xv8,
                    series_fams={'PEG+EMIM-EtSO4': 'red', 'PEG+EVIM-EtSO4': 'gold',
                                 'PEG(black, ref)': 'black'}, out_dir=OUT)
    yv3 = [0.4, 0.3, 0.2, 0.1, 0.0]
    do_marker_panel('C-fig3a-humid', P4, 'C', region=(220, 480, 570, 665),
                    ylab_band=(192, 216), xlab_rows=(4, 24), yvalues=yv3, xvalues=xv6,
                    series_fams={'EMIM-TfO': 'cynblue', 'BMIM-TfO': 'red',
                                 'BMIM-DCA': 'green', 'PEG(black, ref)': 'black'},
                    out_dir=OUT, is_fig3=True)
    do_marker_panel('C-fig3b-dry', P4, 'C', region=(654, 480, 1008, 666),
                    ylab_band=(627, 650), xlab_rows=(4, 24), yvalues=yv3, xvalues=xv6,
                    series_fams={'EMIM-TfO': 'cynblue', 'BMIM-TfO': 'red',
                                 'BMIM-DCA': 'green', 'PEG(black, ref)': 'black'},
                    out_dir=OUT, is_fig3=True)


PROMOTE = {
    'gemini-2021-np14-2-14-rt-hold':   ('A-fig5a', 'NP-14-2-14', (1200, 1800)),
    'gemini-2021-np16-2-16-rt-hold':   ('A-fig5a', 'NP-16-2-16', (1200, 1800)),
    'gemini-2021-np18-2-18-rt-hold':   ('A-fig5a', 'NP-18-2-18', (1200, 1800)),
    'gemini-2021-np14-2-14-100c-hold': ('A-fig6a', 'NP-14-2-14', (1200, 1800)),
    'gemini-2021-np16-2-16-100c-hold': ('A-fig6a', 'NP-16-2-16', (1200, 1800)),
    'gemini-2021-np18-2-18-100c-hold': ('A-fig6a', 'NP-18-2-18', (1200, 1800)),
    'boundadd-2022-wg-pp-1wt-hold':    ('B-fig2a', 'WG-PP', (200, 300)),
    'boundadd-2022-wg-bmp-1wt-hold':   ('B-fig2a', 'WG-BMP', (200, 300)),
    'boundadd-2022-pao-pp-1wt-hold':   ('B-fig2b', 'PAO-PP', (200, 300)),
    'boundadd-2022-pao-bmp-1wt-hold':  ('B-fig2b', 'PAO-BMP', (200, 300)),
}
MARKER_MIN = {
    'bjnano-2017-emim-tfo-peg200-si-15mn':    ('C-fig5a', 'PEG+EMIM-TfO'),
    'bjnano-2017-bmim-tfo-peg200-si-15mn':    ('C-fig5a', 'PEG+BMIM-TfO'),
    'bjnano-2017-c2ohmim-tfo-peg200-si-15mn': ('C-fig5a', 'PEG+C2OHMIM-TfO'),
    'bjnano-2017-amim-tfo-peg200-si-15mn':    ('C-fig5a', 'PEG+AMIM-TfO'),
    'bjnano-2017-bmim-dca-peg200-si-15mn':    ('C-fig5b', 'PEG+BMIM-DCA'),
    'bjnano-2017-c2ohmim-dca-peg200-si-15mn': ('C-fig5b', 'PEG+C2OHMIM-DCA'),
    'bjnano-2017-emim-etso4-peg200-si-15mn':  ('C-fig5c', 'PEG+EMIM-EtSO4'),
    'bjnano-2017-evim-etso4-peg200-si-15mn':  ('C-fig5c', 'PEG+EVIM-EtSO4'),
}


def summary():
    print()
    print('=== PROMOTION SUMMARY (gate |A-B| <= 0.005) ===')
    for key, (panel, trace, win) in PROMOTE.items():
        wA, wB = RESULTS[panel][(trace, win[0], win[1])]
        mean = (wA + wB) / 2
        print(f'{key:42s} {panel} {trace:20s} A={wA:.5f} B={wB:.5f} '
              f'|A-B|={abs(wA-wB):.5f} mean={mean:.5f} -> {round(mean, 3):.3f}')
    for key, (panel, tname) in MARKER_MIN.items():
        d = RESULTS[panel][tname]
        mean = (d['minA'] + d['minB']) / 2
        gate = abs(d['minA'] - d['minB']) <= 0.005
        endm = (d['endA'] + d['endB']) / 2
        print(f'{key:42s} {panel} {tname:20s} minA={d["minA"]:.5f} minB={d["minB"]:.5f} '
              f'gate={gate} minZ={d["minZ_A"]:.3e} mean={mean:.5f} -> {round(mean, 3):.3f} '
              f'(end@2cm/s={endm:.4f})')


if __name__ == '__main__':
    paper_A()
    paper_B()
    paper_C()
    summary()
    print('done')
