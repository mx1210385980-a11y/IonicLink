"""Reproducible pixel-envelope digitization, not author-supplied raw data."""
from pathlib import Path
import json
import numpy as np
from PIL import Image

OUT = Path('data/audit-2026-09-12-final')

def points(source, box, color):
    # Calibration coordinates below refer to this fixed display raster.
    a = np.asarray(Image.open(source).convert('RGB').resize((1376, 1801))).astype(int)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    masks = {'red': (r > 140) & (r-g > 65) & (r-b > 55),
             'green': (g > 95) & (g-r > 20) & (g-b > 30),
             'blue': (b > 100) & (b-r > 45) & (g-r > 15)}
    mask = masks[color]
    x1, y1, x2, y2 = box
    roi = np.zeros(mask.shape, bool)
    roi[y1:y2, x1:x2] = True
    mask &= roi
    xs = np.flatnonzero(mask.sum(0) > 1)
    groups = np.split(xs, np.where(np.diff(xs) > 2)[0]+1)
    result = []
    for group in groups:
        if not len(group):
            continue
        yy, xx = np.where(mask[:, group])
        if len(xx) > 15:
            result.append([float(np.mean(group[xx])), float(np.median(yy))])
    return result

def fit(raw, calibration, lower):
    x0, y0, x_per_unit, y_per_unit = calibration
    data = np.array([[(x-x0)/x_per_unit, (y0-y)/y_per_unit] for x,y in raw])
    data = data[data[:, 0] >= lower]
    assert len(data) >= 5
    x, y = data.T
    slope, intercept = np.polyfit(x, y, 1)
    residual = y-(slope*x+intercept)
    r2 = 1-np.sum(residual**2)/np.sum((y-y.mean())**2)
    trimmed = float(np.polyfit(x[1:-1], y[1:-1], 1)[0])
    # Leave-one-out slope range is an empirical sensitivity diagnostic,
    # not a statistical confidence interval for the original measurements.
    loo = [float(np.polyfit(np.delete(x,i), np.delete(y,i),1)[0]) for i in range(len(x))]
    accepted = slope > 0 and r2 >= .95 and abs(trimmed-slope)/slope < .15
    return {'pixel_points': raw, 'calibration': calibration, 'points_nN': data.tolist(),
            'slope': float(slope), 'intercept_nN': float(intercept), 'r2': float(r2),
            'trimmed_slope': trimmed, 'leave_one_out_range': [min(loo), max(loo)],
            'accepted': bool(accepted), 'method': 'OLS with free intercept on digitized marker-envelope centers; >=5 points, R2>=0.95, endpoint-trim sensitivity<15%'}

results = {}
source = 'data/tribology/sources/64cf80c6-90a3-40a5-9c54-ac9de2347336/page-6@3.png'
# x ticks: 5 nN at 260.5 px, 65 nN at 538.5 px.
# y ticks: 5 nN at 292.5 px, 35 nN at 187 px.
calibration = [260.5-5*(278/60), 292.5+5*(105.5/30), 278/60, 105.5/30]
for id, color in [('#067','blue'),('#068','red'),('#069','green')]:
    results[id] = fit(points(source, (335,150,570,275), color), calibration, 25)
    results[id]['source'] = source
    results[id]['figure'] = 'Fig.4a; 1 Hz; high-load branch'

source = 'data/tribology/sources/a72d3043-447d-4272-88e4-5e7dc5c9b026/page-3@3.png'
# Adjacent panels share y=0 at 1574 px and 120 nN at 1386 px.
for id, box, color, x0, x100, lower in [
    ('#075',(530,1455,668,1558),'green',495,682,20),
    ('#076',(585,1525,668,1555),'red',495,682,50),
    ('#077',(768,1455,902,1555),'green',736,919,20),
    ('#078',(785,1532,902,1560),'red',736,919,30),
    ('#079',(1007,1435,1144,1555),'green',976,1162,15),
    ('#080',(1004,1555,1144,1575),'red',976,1162,15)]:
    results[id] = fit(points(source, box, color), [x0,1574,(x100-x0)/100,188/120], lower)
    results[id]['source'] = source
    results[id]['figure'] = 'Fig.3; concentration/potential as recorded; selected linear branch'

OUT.mkdir(exist_ok=True)
(OUT/'digitized-fits.json').write_text(json.dumps(results,indent=2),encoding='utf8')
for id, result in results.items():
    print(id, 'n=',len(result['points_nN']), 'slope=',round(result['slope'],4), 'R2=',round(result['r2'],4), 'trimmed=',round(result['trimmed_slope'],4), 'accept=',result['accepted'])
