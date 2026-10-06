import json
import re

input_path = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912\batch-all-historical-repaired.json'
output_path = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912\batch-all-historical-repaired-fixed.json'

with open(input_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

fixed = 0
for r in data:
    fields = r.get('fields', {})
    paper = fields.get('paper', {})
    if not paper.get('doi'):
        source_url = r.get('sourceUrl', '')
        # Extract DOI from URL like https://doi.org/10.1039/c8nr08373a
        m = re.search(r'doi\.org/(.+)$', source_url)
        if m:
            doi = m.group(1).rstrip('/')
            paper['doi'] = doi
            fields['paper'] = paper
            fixed += 1
            print(f'  Fixed DOI: {doi} from {r.get("key")}')

print(f'\nFixed {fixed} records with missing DOI')

# Check again
missing = 0
for r in data:
    if not r.get('fields', {}).get('paper', {}).get('doi'):
        missing += 1
        print(f'  Still missing: {r.get("key")}, sourceUrl={r.get("sourceUrl")}')

print(f'Still missing DOI: {missing}')

with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f'Saved to: {output_path}')
print(f'Total records: {len(data)}')
