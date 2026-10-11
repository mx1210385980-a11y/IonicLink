import json
import os

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'

# Load all 92 held-new records
with open(os.path.join(base, 'held-new-deduped.json'), 'r', encoding='utf-8') as f:
    held_new = json.load(f)
print(f'Held-new records: {len(held_new)}')

# Mark all as approve for precheck testing
for r in held_new:
    r['decision'] = 'approve'
    if 're-evaluated' not in r.get('reason', ''):
        r['reason'] = (r.get('reason', '') + ' [batch re-evaluation: promoted from hold for full audit]').strip()

# Save
output_path = os.path.join(base, 'batch-held-all-approve.json')
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(held_new, f, ensure_ascii=False, indent=2)
print(f'Saved {len(held_new)} records to: {output_path}')

# Show reason categories
from collections import Counter
reasons = Counter()
for r in held_new:
    reason = r.get('reason', '')[:60]
    reasons[reason] += 1
print(f'\nReason categories ({len(reasons)} unique):')
for reason, cnt in reasons.most_common(20):
    print(f'  {cnt:>4}  {reason}')
