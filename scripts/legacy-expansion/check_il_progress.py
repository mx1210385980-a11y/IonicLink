import json
import os

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912\batch-extract-round2'
total = 0
il_count = 0

for dname in sorted(os.listdir(base)):
    dpath = os.path.join(base, dname)
    if not os.path.isdir(dpath):
        continue
    drafts_path = os.path.join(dpath, 'ai-drafts.json')
    if not os.path.exists(drafts_path):
        continue
    with open(drafts_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    drafts = data.get('drafts', [])
    total += len(drafts)
    for d in drafts:
        fields = d.get('fields', {})
        cation = str(fields.get('cation', '')).lower()
        anion = str(fields.get('anion', '')).lower()
        bad = ['none', 'not applicable', 'n/a', 'dry', 'plain', 'no ionic', 'il-free']
        if cation and anion and not any(b in cation or b in anion for b in bad):
            il_count += 1
            print(f'  IL: {dname} | {str(fields.get("cation",""))[:35]} | cof={fields.get("cof")}')

print(f'\nTotal drafts: {total}, IL drafts: {il_count}')
