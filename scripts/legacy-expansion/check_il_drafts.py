import json
import os

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912\batch-extract-round2'

# Collect all drafts from extracted PDFs
all_drafts = []
for dname in os.listdir(base):
    dpath = os.path.join(base, dname)
    if not os.path.isdir(dpath):
        continue
    drafts_path = os.path.join(dpath, 'ai-drafts.json')
    if not os.path.exists(drafts_path):
        continue
    with open(drafts_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    for d in data.get('drafts', []):
        d['_pdf'] = dname
        all_drafts.append(d)

print(f'Total extracted drafts: {len(all_drafts)}')

# Filter: has actual ionic liquid (cation/anion not "none", "not applicable", empty)
def has_il(d):
    fields = d.get('fields', {})
    cation = str(fields.get('cation', '')).lower()
    anion = str(fields.get('anion', '')).lower()
    if not cation or not anion:
        return False
    if any(x in cation for x in ['none', 'not applicable', 'n/a', 'not stated', 'dry', 'neat pao', 'plain']):
        return False
    if any(x in anion for x in ['none', 'not applicable', 'n/a', 'not stated', 'dry']):
        return False
    return True

il_drafts = [d for d in all_drafts if has_il(d)]
print(f'Drafts with ionic liquid: {len(il_drafts)}')

# Show IL drafts
for i, d in enumerate(il_drafts):
    fields = d.get('fields', {})
    paper = fields.get('paper', {})
    print(f'\n--- IL Draft {i+1} (PDF: {d["_pdf"]}) ---')
    print(f'  autoOk: {d.get("autoOk")}')
    print(f'  problems: {d.get("problems", [])[:3]}')
    print(f'  paper: {paper.get("title", "")[:70]}')
    print(f'  cation: {fields.get("cation", "")[:50]}')
    print(f'  anion: {fields.get("anion", "")[:50]}')
    print(f'  substrate: {fields.get("substrate", "")[:40]}')
    print(f'  cof: {fields.get("cof")}, temp: {fields.get("temperature")}, load: {fields.get("load")}')
    print(f'  provenance fields: {list(fields.get("provenance", {}).keys()) if isinstance(fields.get("provenance"), dict) else type(fields.get("provenance")).__name__}')

# Save IL drafts for potential repair
output_path = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912\extracted-il-drafts.json'
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(il_drafts, f, ensure_ascii=False, indent=2)
print(f'\nSaved {len(il_drafts)} IL drafts to: {output_path}')
