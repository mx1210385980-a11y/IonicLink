import json
import os

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'

# Debug: check detailed structure of a few approved records
test_files = [
    'reviewed-batch-01.json',
    'reviewed-batch-02.json',
    'reviewed-mdpi-lubricants7040037.json',
]

for fname in test_files:
    fpath = os.path.join(base, fname)
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f'\n{"="*60}')
    print(f'FILE: {fname} ({len(data)} records)')
    print(f'{"="*60}')
    
    # Decision distribution
    from collections import Counter
    decisions = Counter(r.get('decision', 'MISSING') for r in data)
    print(f'Decisions: {dict(decisions)}')
    
    # Find first approved
    approved = [r for r in data if r.get('decision') == 'approve']
    if approved:
        r = approved[0]
        print(f'\n--- First approved record: {r.get("key")} ---')
        print(f'  Top keys: {list(r.keys())}')
        fields = r.get('fields', {})
        print(f'  fields keys: {list(fields.keys())}')
        print(f'  cof: {fields.get("cof")} (type: {type(fields.get("cof")).__name__})')
        prov = fields.get('provenance')
        print(f'  provenance type: {type(prov).__name__}')
        if isinstance(prov, dict):
            print(f'  provenance keys: {list(prov.keys())}')
            for k, v in list(prov.items())[:3]:
                print(f'    {k}: {json.dumps(v, ensure_ascii=False)[:150]}')
        elif isinstance(prov, list):
            print(f'  provenance len: {len(prov)}')
            if prov:
                print(f'  first: {json.dumps(prov[0], ensure_ascii=False)[:200]}')
        else:
            print(f'  provenance value: {prov}')
    else:
        print('  NO approved records found')
        # Show first record's decision
        if data:
            print(f'  First record decision: {data[0].get("decision")}')
            print(f'  First record keys: {list(data[0].keys())}')
