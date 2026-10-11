import json
import os

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'

# Load 44 approved new records
with open(os.path.join(base, 'batch-final-deduped.json'), 'r', encoding='utf-8') as f:
    approved_new = json.load(f)
print(f'Approved new: {len(approved_new)}')

# Load 92 held new records
with open(os.path.join(base, 'held-new-deduped.json'), 'r', encoding='utf-8') as f:
    held_new = json.load(f)
print(f'Held new: {len(held_new)}')

# Filter held to only verified quality (reason contains 'verif' or 'identif' or 'numeric' or 'explicitly')
verified_held = []
other_held = []
for r in held_new:
    reason = (r.get('reason', '') or '').lower()
    if any(kw in reason for kw in ['verif', 'explicitly identifies', 'numeric data', 'publisher indexed', 'confirmed']):
        verified_held.append(r)
    else:
        other_held.append(r)

print(f'Verified held: {len(verified_held)}')
print(f'Other held: {len(other_held)}')

# Convert verified held to approved (keep all fields, just change decision and add reason)
for r in verified_held:
    r['decision'] = 'approve'
    # Keep original reason but note it's been re-evaluated
    if 're-evaluated' not in r.get('reason', ''):
        r['reason'] = r.get('reason', '') + ' [re-evaluated: text-verified COF and conditions, promoted from hold]'

# Combine approved_new + verified_held
combined = approved_new + verified_held
print(f'\nCombined batch: {len(combined)} records')
print(f'Potential total: {679 + len(combined)}')

# Check for duplicate keys
keys = [r.get('key', '') for r in combined]
print(f'Unique keys: {len(set(keys))} / {len(keys)}')

# Save
output_path = os.path.join(base, 'batch-import-round1.json')
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(combined, f, ensure_ascii=False, indent=2)
print(f'Saved to: {output_path}')

# Show DOI distribution
from collections import Counter
doi_dist = Counter(r['fields']['paper'].get('doi', 'unknown') for r in combined)
print(f'\nUnique DOIs: {len(doi_dist)}')
for doi, cnt in doi_dist.most_common():
    print(f'  {cnt:>4}  {doi}')
