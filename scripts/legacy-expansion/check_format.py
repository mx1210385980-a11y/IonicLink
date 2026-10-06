import json
import os

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'

# Check a few representative files
test_files = [
    'reviewed-batch-01.json',
    'reviewed-batch-02.json',
    'reviewed-batch-08-pyrylium.json',
    'reviewed-mdpi-lubricants7040037.json',
    'goal-new-literature/reviewed-boronium.json',
    'batch-03-greases/reviewed-candidates.json',
]

for fname in test_files:
    fpath = os.path.join(base, fname)
    if not os.path.exists(fpath):
        print(f'NOT FOUND: {fname}')
        continue
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    print(f'\n=== {fname} ({len(data)} records) ===')
    if len(data) > 0:
        r = data[0]
        print(f'  Top-level keys: {list(r.keys())}')
        print(f'  has decision: {"decision" in r}')
        print(f'  has reason: {"reason" in r}')
        print(f'  has fields: {"fields" in r}')
        if 'fields' in r:
            print(f'  fields keys: {list(r["fields"].keys())}')
            if 'paper' in r['fields']:
                print(f'  paper: {r["fields"]["paper"]}')
            if 'core' in r['fields']:
                print(f'  core keys: {list(r["fields"]["core"].keys()) if isinstance(r["fields"]["core"], dict) else type(r["fields"]["core"])}')
        if 'decision' in r:
            decisions = {}
            for rec in data:
                d = rec.get('decision', 'missing')
                decisions[d] = decisions.get(d, 0) + 1
            print(f'  decision distribution: {decisions}')
