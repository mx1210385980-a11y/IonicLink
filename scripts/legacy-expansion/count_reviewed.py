import json
import os
import glob

base = r'D:\Julyanffzz\Project\ioniclink\data\literature-expansion-20260912'

# Find all main reviewed JSON files (not plan/receipt)
reviewed_files = []
for root, dirs, files in os.walk(base):
    for f in files:
        if f.startswith('reviewed-') and f.endswith('.json'):
            if 'plan' not in f and 'receipt' not in f:
                reviewed_files.append(os.path.join(root, f))

print(f'Found {len(reviewed_files)} reviewed data files')
print()

total_records = 0
file_stats = []
sample_data = None

for fpath in sorted(reviewed_files):
    try:
        with open(fpath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Determine record count
        if isinstance(data, list):
            count = len(data)
            if sample_data is None and count > 0:
                sample_data = data[0]
                sample_file = fpath
        elif isinstance(data, dict):
            # Could be {records: [...]} or similar
            if 'records' in data and isinstance(data['records'], list):
                count = len(data['records'])
                if sample_data is None and count > 0:
                    sample_data = data['records'][0]
                    sample_file = fpath
            elif 'items' in data and isinstance(data['items'], list):
                count = len(data['items'])
            else:
                count = 1  # single record
                if sample_data is None:
                    sample_data = data
                    sample_file = fpath
        else:
            count = 0
        
        total_records += count
        rel = os.path.relpath(fpath, base)
        file_stats.append((rel, count, type(data).__name__))
    except Exception as e:
        print(f'ERROR reading {fpath}: {e}')

print(f'{"File":<70} {"Count":>6} {"Type":<10}')
print('-' * 90)
for rel, count, dtype in file_stats:
    print(f'{rel:<70} {count:>6} {dtype:<10}')
print('-' * 90)
print(f'TOTAL: {total_records} records across {len(file_stats)} files')

print()
print('=== Sample record structure ===')
if sample_data:
    print(f'From: {sample_file}')
    print(json.dumps(sample_data, indent=2, ensure_ascii=False)[:3000])
