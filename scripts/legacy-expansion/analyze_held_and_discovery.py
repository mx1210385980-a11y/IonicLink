import json
import os
from collections import Counter

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'
root = r'D:\Julyanffzz\Project\ioniclink'

# Find all reviewed files
reviewed_files = []
for dirpath, dirnames, filenames in os.walk(base):
    for f in filenames:
        if f.startswith('reviewed-') and f.endswith('.json'):
            if 'plan' not in f and 'receipt' not in f and 'pre-recheck' not in f and 'backup' not in f:
                reviewed_files.append(os.path.join(dirpath, f))

# Collect all held records with valid PDF and COF
held_valid = []
held_reasons = Counter()
for fpath in sorted(reviewed_files):
    rel = os.path.relpath(fpath, base)
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if not isinstance(data, list):
        continue
    for rec in data:
        if rec.get('decision') != 'hold':
            continue
        reason = rec.get('reason', '')[:80]
        held_reasons[reason] += 1
        
        # Check if it has valid PDF and COF
        pdf_rel = rec.get('sourcePdf', '')
        pdf_path = os.path.join(root, pdf_rel) if pdf_rel else ''
        fields = rec.get('fields', {})
        cof = fields.get('cof')
        if pdf_path and os.path.exists(pdf_path) and cof is not None and isinstance(cof, (int, float)) and cof >= 0:
            rec['_source_file'] = rel
            held_valid.append(rec)

print(f'=== HELD RECORDS ANALYSIS ===')
print(f'Total held with valid PDF+COF: {len(held_valid)}')
print(f'\nTop hold reasons:')
for reason, cnt in held_reasons.most_common(20):
    print(f'  {cnt:>4}  {reason}')

# DOI distribution of held valid
doi_dist = Counter(r['fields']['paper'].get('doi', 'unknown') for r in held_valid)
print(f'\nUnique DOIs in held-valid: {len(doi_dist)}')
print(f'Top 15:')
for doi, cnt in doi_dist.most_common(15):
    print(f'  {cnt:>4}  {doi}')

# Save held-valid pool
output_path = os.path.join(base, 'held-valid-candidates.json')
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(held_valid, f, ensure_ascii=False, indent=2)
print(f'\nSaved {len(held_valid)} held-valid records to: {output_path}')

# Now check discovery directories for raw data
print(f'\n=== DISCOVERY DIRECTORIES ===')
for dname in ['discovery-papers', 'discovery-pmc', 'discovery-mdpi', 'discovery-osti', 'discovery-friction', 'discovery-datasets', 'discovery-institutions', 'discovery-bulk-02', 'discovery-bulk-03', 'discovery-chinese-03', 'discovery-r6', 'discovery-polymers', 'crawled-wave']:
    dpath = os.path.join(base, dname)
    if os.path.exists(dpath):
        files = os.listdir(dpath)
        json_files = [f for f in files if f.endswith('.json')]
        pdf_files = [f for f in files if f.endswith('.pdf')]
        print(f'  {dname}: {len(files)} files ({len(json_files)} json, {len(pdf_files)} pdf)')
