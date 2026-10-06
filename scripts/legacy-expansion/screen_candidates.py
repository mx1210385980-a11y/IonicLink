import json
import os
import hashlib

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'
root = r'D:\Julyanffzz\Project\ioniclink'

# Find all main reviewed JSON files
reviewed_files = []
for dirpath, dirnames, filenames in os.walk(base):
    for f in filenames:
        if f.startswith('reviewed-') and f.endswith('.json'):
            if 'plan' not in f and 'receipt' not in f and 'pre-recheck' not in f:
                reviewed_files.append(os.path.join(dirpath, f))

print(f'Found {len(reviewed_files)} reviewed data files')

all_approved = []
all_held = []
missing_pdf = []
invalid_cof = []
missing_provenance = []
seen_keys = set()
seen_identities = set()

def simple_identity(r):
    """Simplified identity hash for cross-file dedup (mirrors TS logic roughly)"""
    fields = r.get('fields', {})
    paper = fields.get('paper', {})
    doi = paper.get('doi', paper.get('title', ''))
    cation = fields.get('cation', '')
    anion = fields.get('anion', '')
    substrate = fields.get('substrate', '')
    temp = str(fields.get('temperature', ''))
    load = str(fields.get('load', ''))
    method = str(fields.get('method', ''))
    probe = str(fields.get('probe', ''))
    cof = fields.get('cof')
    # Note: TS identity excludes COF, but we include it for stricter dedup
    raw = f"{doi}|{cation}|{anion}|{substrate}|{temp}|{load}|{method}|{probe}|{cof}"
    return hashlib.sha256(raw.lower().encode()).hexdigest()

for fpath in sorted(reviewed_files):
    rel = os.path.relpath(fpath, base)
    try:
        with open(fpath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f'  ERROR reading {rel}: {e}')
        continue
    
    if not isinstance(data, list):
        continue
    
    approved_count = 0
    for rec in data:
        decision = rec.get('decision', '')
        if decision != 'approve':
            all_held.append((rel, rec))
            continue
        
        key = rec.get('key', '')
        if key in seen_keys:
            continue  # duplicate key across files
        seen_keys.add(key)
        
        # Check PDF exists
        pdf_rel = rec.get('sourcePdf', '')
        pdf_path = os.path.join(root, pdf_rel) if pdf_rel else ''
        if not pdf_path or not os.path.exists(pdf_path):
            missing_pdf.append((rel, key, pdf_rel))
            continue
        
        # Check COF valid
        fields = rec.get('fields', {})
        cof = fields.get('cof')
        if cof is None or not isinstance(cof, (int, float)) or cof < 0 or cof != cof:
            invalid_cof.append((rel, key, cof))
            continue
        
        # Check provenance exists
        provenance = fields.get('provenance', {})
        if not provenance or not isinstance(provenance, dict):
            missing_provenance.append((rel, key))
            continue
        
        # Cross-file identity dedup
        ident = simple_identity(rec)
        if ident in seen_identities:
            continue
        seen_identities.add(ident)
        
        rec['_source_file'] = rel
        all_approved.append(rec)
        approved_count += 1
    
    print(f'  {rel}: {len(data)} total, {approved_count} approved (valid)')

print(f'\n=== SUMMARY ===')
print(f'Total valid approved records (after dedup & checks): {len(all_approved)}')
print(f'Total held: {len(all_held)}')
print(f'Missing PDF: {len(missing_pdf)}')
print(f'Invalid COF: {len(invalid_cof)}')
print(f'Missing provenance: {len(missing_provenance)}')

# Distribution by source file
from collections import Counter
file_dist = Counter(r['_source_file'] for r in all_approved)
print(f'\n=== Records per source file (top 30) ===')
for fname, cnt in file_dist.most_common(30):
    print(f'  {cnt:>4}  {fname}')

# DOI distribution
doi_dist = Counter(r['fields']['paper'].get('doi', 'unknown') for r in all_approved)
print(f'\n=== Unique DOIs: {len(doi_dist)} ===')
print(f'Top 20 DOIs by record count:')
for doi, cnt in doi_dist.most_common(20):
    print(f'  {cnt:>4}  {doi}')

# Save the full candidate pool
output_path = os.path.join(base, 'candidate-pool-all-approved.json')
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(all_approved, f, ensure_ascii=False, indent=2)
print(f'\nSaved candidate pool to: {output_path}')
