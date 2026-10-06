import os
import sqlite3
import json

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'
root = r'D:\Julyanffzz\Project\ioniclink'

# Get all PDFs in discovery and crawled directories
all_pdfs = []
for dirpath, dirnames, filenames in os.walk(base):
    for f in filenames:
        if f.endswith('.pdf'):
            all_pdfs.append(os.path.join(dirpath, f))

print(f'Total PDFs in literature-expansion: {len(all_pdfs)}')

# Get PDFs already in database (from sources table)
conn = sqlite3.connect(os.path.join(root, 'data/tribology.db'))
cur = conn.cursor()
cur.execute('SELECT filename, payload FROM sources')
db_sources = cur.fetchall()
conn.close()

db_pdf_names = set()
for filename, payload in db_sources:
    db_pdf_names.add(filename.lower())
    if payload:
        try:
            p = json.loads(payload)
            if 'filename' in p:
                db_pdf_names.add(p['filename'].lower())
        except:
            pass

print(f'PDFs already in DB sources: {len(db_pdf_names)}')

# Find PDFs not yet in DB
unprocessed = []
for pdf_path in all_pdfs:
    pdf_name = os.path.basename(pdf_path).lower()
    if pdf_name not in db_pdf_names:
        unprocessed.append(pdf_path)

print(f'\nUnprocessed PDFs: {len(unprocessed)}')

# Group by directory
from collections import Counter
dir_dist = Counter(os.path.basename(os.path.dirname(p)) for p in unprocessed)
print('\nUnprocessed PDFs by directory:')
for d, cnt in dir_dist.most_common():
    print(f'  {cnt:>4}  {d}')

# List unprocessed PDFs
print('\n=== Unprocessed PDF list ===')
for p in sorted(unprocessed):
    rel = os.path.relpath(p, base)
    size = os.path.getsize(p)
    print(f'  {size:>8} bytes  {rel}')

# Save list
with open(os.path.join(base, 'unprocessed-pdfs.json'), 'w', encoding='utf-8') as f:
    json.dump([os.path.relpath(p, root) for p in sorted(unprocessed)], f, indent=2)
print(f'\nSaved list to unprocessed-pdfs.json')
