import json

with open(r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912\batch-all-historical-repaired.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

print(f'Total: {len(data)}')
missing_doi = 0
missing_url = 0
missing_pdf = 0
for r in data:
    fields = r.get('fields', {})
    paper = fields.get('paper', {})
    if not paper.get('doi'):
        missing_doi += 1
    if not r.get('sourceUrl'):
        missing_url += 1
    if not r.get('sourcePdf'):
        missing_pdf += 1

print(f'Missing DOI: {missing_doi}')
print(f'Missing sourceUrl: {missing_url}')
print(f'Missing sourcePdf: {missing_pdf}')

# Show first few missing DOI records
count = 0
for r in data:
    fields = r.get('fields', {})
    paper = fields.get('paper', {})
    if not paper.get('doi') and count < 3:
        print(f'\nMissing DOI record:')
        print(f'  key: {r.get("key")}')
        print(f'  sourceUrl: {r.get("sourceUrl")}')
        print(f'  sourcePdf: {r.get("sourcePdf")}')
        print(f'  paper keys: {list(paper.keys())}')
        print(f'  paper: {json.dumps(paper)[:300]}')
        count += 1
