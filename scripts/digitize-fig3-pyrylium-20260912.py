"""Digitize main-paper Figure 3 (percent COF change bars, p4) and compare with
S20-derived percentages. Both color mappings and reference normalizations tested.
"""
import numpy as np
from PIL import Image, ImageDraw

PAGE = 'data/literature-expansion-20260912/batch-08-pyrylium/pages/page-4-x8.png'
CONDS = ['1a', '1b', '2a', '2b', '3', 'PP']
TICKVALS = [20, 10, 0, -10, -20]


def ndlabel(mask):
    """8-connected component labels without scipy (two-pass union-find on rows)."""
    try:
        from scipy import ndimage
        return ndimage.label(mask, structure=np.ones((3, 3)))
    except ImportError:
        pass
    lab = np.zeros(mask.shape, dtype=int)
    parent = [0]

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[max(rx, ry)] = min(rx, ry)
    h, w = mask.shape
    nxt = 1
    for y in range(h):
        row = mask[y]
        if not row.any():
            continue
        for x in np.where(row)[0]:
            neigh = set()
            if y > 0:
                for dx in (-1, 0, 1):
                    xx = x + dx
                    if 0 <= xx < w and lab[y - 1, xx]:
                        neigh.add(lab[y - 1, xx])
            if x > 0 and lab[y, x - 1]:
                neigh.add(lab[y, x - 1])
            if not neigh:
                parent.append(nxt)
                lab[y, x] = nxt
                nxt += 1
            else:
                m = min(find(v) for v in neigh)
                lab[y, x] = m
                for v in neigh:
                    union(m, v)
    # flatten
    for y in range(h):
        for x in np.where(lab[y])[0]:
            lab[y, x] = find(lab[y, x])
    uniq = sorted(set(lab[lab > 0].tolist()))
    remap = {v: i + 1 for i, v in enumerate(uniq)}
    for old, new in remap.items():
        lab[lab == old] = new
    return lab, len(uniq)


def longest_run(v):
    best = cur = 0
    for b in v:
        cur = cur + 1 if b else 0
        best = max(best, cur)
    return best


def group_runs(flags, gap=4):
    """Consecutive runs. Accepts a boolean mask (uses its True indices) or a
    sorted list/array of coordinates."""
    fl = np.asarray(flags)
    if fl.dtype == bool:
        idx = np.where(fl)[0].tolist()
    else:
        idx = [int(v) for v in fl]
    if not len(idx):
        return []
    out = []
    cur = [idx[0]]
    for y in idx[1:]:
        if y - cur[-1] <= gap:
            cur.append(y)
        else:
            out.append((cur[0], cur[-1]))
            cur = [y]
    out.append((cur[0], cur[-1]))
    return out


def main():
    a = np.asarray(Image.open(PAGE).convert('RGB')).astype(int)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    lum = a.mean(axis=2)
    dark = lum < 200  # ticks are light gray
    orange = ((R - B) > 40) & ((R - G) > 18) & (R > 200)
    green = ((G - R) > 12) & ((G - B) > 22) & (G > 165)

    panels = {}
    for pname, (y0, y1) in (('40C', (450, 1250)), ('100C', (1300, 2100))):
        # axis column
        best = (0, 0)
        for c in range(3100, 3220):
            r = longest_run(dark[y0:min(y1, a.shape[0]), c])
            if r > best[0]:
                best = (r, c)
        ax = best[1]
        # ticks: light-gray marks left of the axis
        rows = [y for y in range(y0, min(y1, a.shape[0])) if dark[y, ax - 33:ax - 3].mean() > 0.4]
        ticks = [int(np.median(g)) for g in group_runs(rows)]
        print(f'panel {pname}: axis {ax}, ticks {ticks}')
        assert len(ticks) == 5, ticks
        m, b = np.polyfit(ticks, TICKVALS, 1)
        res = np.max(np.abs(np.array(TICKVALS) - (m * np.array(ticks) + b)))
        zrow = (0 - b) / m
        print(f'  fit px->pct: residual {res:.3f} pct; zero-row {zrow:.1f}')
        cal = lambda row: m * row + b
        # bars via 2-D connected components (drops legend swatches, which do not
        # touch the zero line and are separate components from the bars)
        x0, x1 = ax + 4, ax + 1050
        y_lo, y_hi = max(y0, int(zrow) - 330), min(y1, int(zrow) + 330)
        bars = {}
        for cname, mask in (('A', orange), ('B', green)):
            mm = np.zeros_like(mask)
            mm[y_lo:y_hi, x0:x1] = mask[y_lo:y_hi, x0:x1]
            lab, n = ndlabel(mm)
            br = []
            for i in range(1, n + 1):
                ys, xs = np.where(lab == i)
                if len(ys) < 400:
                    continue
                s, e = int(xs.min()), int(xs.max())
                if e - s <= 15:
                    continue
                touches = np.any(np.abs(ys - zrow) <= 10)
                if not touches:
                    print(f'  dropped non-zero-touching {cname} blob x[{s},{e}] y[{ys.min()},{ys.max()}] (legend swatch)')
                    continue
                br.append((s, e))
            br.sort()
            bars[cname] = br
            print(f'  {cname} bars: {br}')
        # assign bars to the 6 expected group slots: groups are evenly pitched;
        # anchor centers from the outermost complete pair slots
        allbars = [(s, e, 'A') for s, e in bars['A']] + [(s, e, 'B') for s, e in bars['B']]
        allbars.sort()
        c_first = (bars['A'][0][0] + bars['B'][0][1]) / 2
        c_last = (bars['A'][-1][0] + bars['B'][-1][1]) / 2
        centers = np.linspace(c_first, c_last, 6)
        vals = {}
        lab_store = {}
        for cname, mask in (('A', orange), ('B', green)):
            mm = np.zeros_like(mask)
            mm[y_lo:y_hi, x0:x1] = mask[y_lo:y_hi, x0:x1]
            lab, n = ndlabel(mm)
            lab_store[cname] = (lab, n)
        for cond, cxc in zip(CONDS, centers):
            for cname in ('A', 'B'):
                lab, n = lab_store[cname]
                comp = None
                for i in range(1, n + 1):
                    ys, xs = np.where(lab == i)
                    if len(ys) < 400 or xs.max() - xs.min() <= 15:
                        continue
                    if not np.any(np.abs(ys - zrow) <= 10):
                        continue
                    if abs((xs.min() + xs.max()) / 2 - cxc) < 60:
                        comp = (ys, xs, i)
                        break
                if comp is None:
                    vals[(cond, cname)] = 0.0
                    print(f'  {cond} grease {cname}: no bar drawn near {cxc:.0f} -> value ~0')
                    continue
                ys, xs, ci = comp
                s, e = int(xs.min()), int(xs.max())
                w = e - s + 1
                core = slice(s + w // 5, e - w // 5 + 1)
                tops, bots = [], []
                for c in range(core.start, core.stop):
                    rows = ys[xs == c]
                    if len(rows):
                        tops.append(rows.min())
                        bots.append(rows.max())
                t, btm = float(np.median(tops)), float(np.median(bots))
                # bar is drawn from the zero line to the value: the value end is
                # the one FARTHER from the zero row
                top_v, bot_v = cal(t), cal(btm)
                v = top_v if abs(t - zrow) > abs(btm - zrow) else bot_v
                vals[(cond, cname)] = v
        panels[pname] = vals

    print('\n=== Figure 3 digitized % change ===')
    fig3 = {}
    for pname, vals in panels.items():
        for cond in CONDS:
            for g in ('A', 'B'):
                fig3[(pname, cond, g)] = vals[(cond, g)]
                print(f'{pname} {cond:3s} grease {g}: {vals[(cond,g)]:+6.2f} %')

    # ---- S20-derived percentages (from the two-pass table; A/B mean per bar)
    s20 = {  # (panel, cond, grease) -> COF
        ('40C', 'Neat', 'A'): (0.0977 + 0.0972) / 2, ('40C', 'Neat', 'B'): (0.0927 + 0.0921) / 2,
        ('100C', 'Neat', 'A'): (0.0998 + 0.0990) / 2, ('100C', 'Neat', 'B'): (0.0908 + 0.0901) / 2,
        ('40C', '1a', 'A'): (0.0869 + 0.0861) / 2, ('40C', '1a', 'B'): (0.0919 + 0.0910) / 2,
        ('40C', '1b', 'A'): (0.0998 + 0.0990) / 2, ('40C', '1b', 'B'): (0.0790 + 0.0781) / 2,
        ('40C', '2a', 'A'): (0.0968 + 0.0961) / 2, ('40C', '2a', 'B'): (0.0790 + 0.0781) / 2,
        ('40C', '2b', 'A'): (0.0977 + 0.0972) / 2, ('40C', '2b', 'B'): (0.0797 + 0.0792) / 2,
        ('40C', '3', 'A'): (0.0948 + 0.0939) / 2, ('40C', '3', 'B'): (0.0939 + 0.0932) / 2,
        ('40C', 'PP', 'A'): (0.0829 + 0.0821) / 2, ('40C', 'PP', 'B'): (0.0847 + 0.0843) / 2,
        ('100C', '1a', 'A'): (0.0927 + 0.0921) / 2, ('100C', '1a', 'B'): (0.0968 + 0.0961) / 2,
        ('100C', '1b', 'A'): (0.1199 + 0.1192) / 2, ('100C', '1b', 'B'): (0.0878 + 0.0872) / 2,
        ('100C', '2a', 'A'): (0.0968 + 0.0961) / 2, ('100C', '2a', 'B'): (0.0808 + 0.0803) / 2,
        ('100C', '2b', 'A'): (0.1099 + 0.1090) / 2, ('100C', '2b', 'B'): (0.0847 + 0.0843) / 2,
        ('100C', '3', 'A'): (0.0888 + 0.0881) / 2, ('100C', '3', 'B'): (0.0727 + 0.0721) / 2,
        ('100C', 'PP', 'A'): (0.0919 + 0.0910) / 2, ('100C', 'PP', 'B'): (0.0838 + 0.0832) / 2,
    }

    print('\n=== comparison: Fig3 % vs S20-derived % (same-grease same-temp Neat ref) ===')
    print(f"{'cond':5s} {'gr':2s} {'Fig3-40':>8s} {'S20-40':>8s} {'Fig3-100':>9s} {'S20-100':>8s}")
    for cond in CONDS:
        for g in ('A', 'B'):
            row = []
            for pn in ('40C', '100C'):
                f = fig3[(pn, cond, g)]
                s = 100 * (s20[(pn, cond, g)] - s20[(pn, 'Neat', g)]) / s20[(pn, 'Neat', g)]
                row.extend([f, s])
            print(f'{cond:5s} {g:2s} {row[0]:8.2f} {row[1]:8.2f} {row[2]:9.2f} {row[3]:8.2f}')

    # swapped-color hypothesis score
    def score(swap):
        err = []
        for cond in CONDS:
            for g in ('A', 'B'):
                gg = ('B' if g == 'A' else 'A') if swap else g
                for pn in ('40C', '100C'):
                    f = fig3[(pn, cond, g)]
                    s = 100 * (s20[(pn, cond, gg)] - s20[(pn, 'Neat', gg)]) / s20[(pn, 'Neat', gg)]
                    err.append(abs(f - s))
        return float(np.mean(err)), float(np.max(err))
    print('\nmean/max |Fig3 - S20derived| : direct mapping', score(False), ' swapped', score(True))


if __name__ == '__main__':
    main()
