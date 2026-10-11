import json
import os

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'

# Check several large/interesting JSON files
files_to_check = [
    'discovery-bulk-02/polymer-workbook-series.json',
    'discovery-bulk-02/polymer-appendix-tables.json',
    'discovery-bulk-02/polymer-workbook-summary.json',
    'discovery-bulk-02/part1-openalex.json',
    'discovery-bulk-02/bombard-openalex.json',
    'discovery-chinese-03/validate-candidates.ts',
]

for fname in files_to_check:
    fpath = os.path.join(base, fname)
    if not os.path.exists(fpath):
        print(f'NOT FOUND: {fname}')
        continue
    if fname.endswith('.ts'):
        print(f'\n=== {fname} (TypeScript file, skipping JSON parse) ===')
        continue
    try:
        with open(fpath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f'\n=== {fname} ===')
        print(f'  type: {type(data).__name__}')
        if isinstance(data, list):
            print(f'  length: {len(data)}')
            if data and isinstance(data[0], dict):
                print(f'  first item keys: {list(data[0].keys())[:15]}')
                # Check if it looks like extracted records
                has_paper = 'paper' in data[0] or 'paper_title' in data[0]
                has_cof = 'cof' in data[0] or ('fields' in data[0] and 'cof' in data[0].get('fields', {}))
                print(f'  looks like record: has_paper={has_paper}, has_cof={has_cof}')
                print(f'  sample: {json.dumps(data[0], ensure_ascii=False)[:250]}')
        elif isinstance(data, dict):
            keys = list(data.keys())
            print(f'  keys ({len(keys)}): {keys[:15]}')
            for k in keys[:3]:
                v = data[k]
                if isinstance(v, list):
                    print(f'    {k}: list of {len(v)}')
                    if v and isinstance(v[0], dict):
                        print(f'      first keys: {list(v[0].keys())[:10]}')
                elif isinstance(v, dict):
                    print(f'    {k}: dict with keys {list(v.keys())[:8]}')
                else:
                    print(f'    {k}: {type(v).__name__} = {str(v)[:80]}')
    except Exception as e:
        print(f'  ERROR: {e}')
