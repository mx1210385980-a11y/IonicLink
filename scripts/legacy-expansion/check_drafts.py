import json
import os

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912\batch-extract-round2'

for dname in sorted(os.listdir(base)):
    dpath = os.path.join(base, dname)
    if not os.path.isdir(dpath):
        continue
    drafts_path = os.path.join(dpath, 'ai-drafts.json')
    if not os.path.exists(drafts_path):
        continue
    with open(drafts_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    print(f'=== {dname} ===')
    s = data.get('summary', {})
    print(f'  extracted={s.get("extracted")}, autoOk={s.get("autoOk")}, model={s.get("model")}')
    for i, d in enumerate(data.get('drafts', [])):
        print(f'  Draft {i+1}: autoOk={d.get("autoOk")}')
        problems = d.get('problems', [])
        for p in problems:
            print(f'    - {p[:120]}')
        fields = d.get('fields', {})
        paper = fields.get('paper', {})
        print(f'    paper: {paper.get("title", "")[:70]}')
        print(f'    cation={fields.get("cation", "")[:30]}, anion={fields.get("anion", "")[:30]}')
        print(f'    cof={fields.get("cof")}, temp={fields.get("temperature")}, load={fields.get("load")}')
    print()
