import json
import os
import hashlib
from collections import Counter

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'
root = r'D:\Julyanffzz\Project\ioniclink'

# Find all main reviewed JSON files (exclude plan/receipt/backup)
reviewed_files = []
for dirpath, dirnames, filenames in os.walk(base):
    for f in filenames:
        if f.startswith('reviewed-') and f.endswith('.json'):
            if 'plan' not in f and 'receipt' not in f and 'pre-recheck' not in f and 'backup' not in f:
                reviewed_files.append(os.path.join(dirpath, f))

print(f'Found {len(reviewed_files)} reviewed data files')

all_approved = []
seen_keys = set()
seen_identities = set()
stats = {
    'total_records': 0,
    'approved': 0,
    'held': 0,
    'missing_pdf': 0,
    'invalid_cof': 0,
    'missing_provenance': 0,
    'dup_key': 0,
    'dup_identity': 0,
}

def simple_identity(r):
    fields = r.get('fields', {})
    paper = fields.get('paper', {})
    doi = paper.get('doi', paper.get('title', ''))
    cation = str(fields.get('cation', ''))
    anion = str(fields.get('anion', ''))
    substrate = str(fields.get('substrate', ''))
    temp = str(fields.get('temperature', ''))
    load = str(fields.get('load', ''))
    method = str(fields.get('method', ''))
    probe = str(fields.get('probe', ''))
    raw = f"{doi}|{cation}|{anion}|{substrate}|{temp}|{load}|{method}|{probe}"
    return hashlib.sha256(raw.lower().encode()).hexdigest()

def has_valid_provenance(fields):
    prov = fields.get('provenance')
    if not prov:
        return False
    if isinstance(prov, list):
        # Check key fields have provenance entries
        prov_fields = set(p.get('field', '') for p in prov if isinstance(p, dict))
        required = {'cation', 'anion', 'substrate', 'cof'}
        return required.issubset(prov_fields)
    if isinstance(prov, dict):
        return all(k in prov for k in ['cation', 'anion', 'substrate', 'cof'])
    return False

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
    
    file_approved = 0
    for rec in data:
        stats['total_records'] += 1
        decision = rec.get('decision', '')
        
        if decision != 'approve':
            stats['held'] += 1
            continue
        stats['approved'] += 1
        
        key = rec.get('key', '')
        if key in seen_keys:
            stats['dup_key'] += 1
            continue
        seen_keys.add(key)
        
        # Check PDF exists
        pdf_rel = rec.get('sourcePdf', '')
        pdf_path = os.path.join(root, pdf_rel) if pdf_rel else ''
        if not pdf_path or not os.path.exists(pdf_path):
            stats['missing_pdf'] += 1
            continue
        
        # Check COF valid
        fields = rec.get('fields', {})
        cof = fields.get('cof')
        if cof is None or not isinstance(cof, (int, float)) or cof < 0 or cof != cof:
            stats['invalid_cof'] += 1
            continue
        
        # Check provenance
        if not has_valid_provenance(fields):
            stats['missing_provenance'] += 1
            continue
        
        # Cross-file identity dedup
        ident = simple_identity(rec)
        if ident in seen_identities:
            stats['dup_identity'] += 1
            continue
        seen_identities.add(ident)
        
        rec['_source_file'] = rel
        all_approved.append(rec)
        file_approved += 1
    
    if file_approved > 0:
        print(f'  {rel}: {file_approved} valid approved')

print(f'\n{"="*60}')
print(f'SUMMARY')
print(f'{"="*60}')
print(f'Total records scanned: {stats["total_records"]}')
print(f'  Approved: {stats["approved"]}')
print(f'  Held: {stats["held"]}')
print(f'After filters:')
print(f'  Missing PDF: {stats["missing_pdf"]}')
print(f'  Invalid COF: {stats["invalid_cof"]}')
print(f'  Missing provenance: {stats["missing_provenance"]}')
print(f'  Duplicate key: {stats["dup_key"]}')
print(f'  Duplicate identity: {stats["dup_identity"]}')
print(f'  -> VALID UNIQUE APPROVED: {len(all_approved)}')

# DOI distribution
doi_dist = Counter(r['fields']['paper'].get('doi', 'unknown') for r in all_approved)
print(f'\nUnique DOIs: {len(doi_dist)}')
print(f'Top 25 DOIs:')
for doi, cnt in doi_dist.most_common(25):
    print(f'  {cnt:>4}  {doi}')

# Year distribution
year_dist = Counter(r['fields']['paper'].get('year', 'unknown') for r in all_approved)
print(f'\nYear distribution:')
for year in sorted(year_dist.keys(), key=str):
    print(f'  {year}: {year_dist[year]}')

# Save candidate pool
output_path = os.path.join(base, 'candidate-pool-valid.json')
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(all_approved, f, ensure_ascii=False, indent=2)
print(f'\nSaved {len(all_approved)} candidates to: {output_path}')
