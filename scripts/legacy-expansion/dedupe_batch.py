import json
import os
import hashlib

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'
input_path = os.path.join(base, 'batch-full-candidates.json')

with open(input_path, 'r', encoding='utf-8') as f:
    candidates = json.load(f)

print(f'Input candidates: {len(candidates)}')

def canonical_value(v):
    """Mirror TS canonical() roughly"""
    if isinstance(v, list):
        return [canonical_value(x) for x in v]
    if isinstance(v, dict):
        return {k: canonical_value(v[k]) for k in sorted(v.keys())}
    if isinstance(v, str):
        return v.lower().replace(' ', ' ').strip()
    return v

def identity_from_fields(fields):
    """
    Approximate TS identity() based on raw ExtractedFields.
    TS identity operates on post-ingest IonicRecord, but we can approximate
    using the raw fields that map to the identity components.
    """
    paper = fields.get('paper', {})
    doi = paper.get('doi') or paper.get('title', '')
    
    # ions -> core.ionicLiquid (cation + anion)
    cation = fields.get('cation', '')
    anion = fields.get('anion', '')
    
    substrate = fields.get('substrate', '')
    
    # temperature/load -> quantities with raw/std/stdUnit
    # In raw fields these are strings like "80 °C" or "50 N"
    temp = fields.get('temperature', '')
    load = fields.get('load', '')
    
    # extended fields
    probe = fields.get('probe', '')
    method = fields.get('method', '')
    velocity = fields.get('velocity', '')
    potential = fields.get('potential', '')
    additives = fields.get('additives', '')
    concentration = fields.get('concentration', '')
    film_thickness = fields.get('filmThickness', '')
    film_layers = fields.get('filmLayers', '')
    water_content = fields.get('waterContent', '')
    cof_method = fields.get('cofMethod', '')
    
    # distinguishing flexible fields
    flexible = fields.get('flexible', [])
    distinguishing = []
    if isinstance(flexible, list):
        for f in flexible:
            if isinstance(f, dict) and f.get('key') in ['surface_preparation', 'measurement_stage', 'lubricant_label', 'sample_preparation', 'replicate_id']:
                distinguishing.append({'key': f.get('key'), 'value': f.get('value')})
    
    identity_obj = {
        'doi': doi,
        'cation': cation,
        'anion': anion,
        'substrate': substrate,
        'temperature': str(temp),
        'load': str(load),
        'probe': str(probe),
        'method': str(method),
        'velocity': str(velocity),
        'potential': str(potential),
        'additives': str(additives),
        'concentration': str(concentration),
        'filmThickness': str(film_thickness),
        'filmLayers': str(film_layers),
        'waterContent': str(water_content),
        'cofMethod': str(cof_method),
        'distinguishing': distinguishing,
    }
    
    canonical = canonical_value(identity_obj)
    return hashlib.sha256(json.dumps(canonical, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

# Deduplicate by identity, keep first occurrence
seen = set()
deduped = []
duplicates = 0
for rec in candidates:
    ident = identity_from_fields(rec.get('fields', {}))
    if ident in seen:
        duplicates += 1
        continue
    seen.add(ident)
    deduped.append(rec)

print(f'Duplicates removed: {duplicates}')
print(f'After dedup: {len(deduped)}')
print(f'Potential total after import: {679 + len(deduped)}')

# Save
output_path = os.path.join(base, 'batch-deduped.json')
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(deduped, f, ensure_ascii=False, indent=2)
print(f'Saved to: {output_path}')

# Show DOI distribution
from collections import Counter
doi_dist = Counter(r['fields']['paper'].get('doi', 'unknown') for r in deduped)
print(f'\nUnique DOIs: {len(doi_dist)}')
for doi, cnt in doi_dist.most_common(10):
    print(f'  {cnt:>4}  {doi}')
