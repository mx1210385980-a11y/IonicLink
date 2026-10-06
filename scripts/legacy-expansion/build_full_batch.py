import json
import os
from collections import Counter

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'
root = r'D:\Julyanffzz\Project\ioniclink'

# Find all main reviewed JSON files
reviewed_files = []
for dirpath, dirnames, filenames in os.walk(base):
    for f in filenames:
        if f.startswith('reviewed-') and f.endswith('.json'):
            if 'plan' not in f and 'receipt' not in f and 'pre-recheck' not in f and 'backup' not in f:
                reviewed_files.append(os.path.join(dirpath, f))

print(f'Found {len(reviewed_files)} reviewed data files')

# Collect all approved with existing PDF, dedup by key (keep first occurrence)
seen_keys = set()
candidates = []
missing_pdf = 0
invalid_cof = 0
total_approved = 0

for fpath in sorted(reviewed_files):
    rel = os.path.relpath(fpath, base)
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if not isinstance(data, list):
        continue
    
    for rec in data:
        if rec.get('decision') != 'approve':
            continue
        total_approved += 1
        
        key = rec.get('key', '')
        if key in seen_keys:
            continue
        seen_keys.add(key)
        
        # Check PDF exists
        pdf_rel = rec.get('sourcePdf', '')
        pdf_path = os.path.join(root, pdf_rel) if pdf_rel else ''
        if not pdf_path or not os.path.exists(pdf_path):
            missing_pdf += 1
            continue
        
        # Check COF valid
        fields = rec.get('fields', {})
        cof = fields.get('cof')
        if cof is None or not isinstance(cof, (int, float)) or cof < 0 or cof != cof:
            invalid_cof += 1
            continue
        
        # Clean internal fields if any
        rec.pop('_source_file', None)
        candidates.append(rec)

print(f'Total approved: {total_approved}')
print(f'Missing PDF (skipped): {missing_pdf}')
print(f'Invalid COF (skipped): {invalid_cof}')
print(f'Unique-key candidates with valid PDF+COF: {len(candidates)}')

# DOI distribution
doi_dist = Counter(r['fields']['paper'].get('doi', 'unknown') for r in candidates)
print(f'Unique DOIs: {len(doi_dist)}')

# Save full candidate pool
output_path = os.path.join(base, 'batch-full-candidates.json')
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(candidates, f, ensure_ascii=False, indent=2)
print(f'\nSaved {len(candidates)} candidates to: {output_path}')
print(f'Current DB: 679, if all imported -> {679 + len(candidates)}')
