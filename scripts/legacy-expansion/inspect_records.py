import sqlite3
import json

db_path = r'D:\Julyanffzz\Project\ioniclink\data\tribology.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Status distribution
print('=== records status distribution ===')
cur.execute("SELECT status, COUNT(*) FROM records GROUP BY status ORDER BY COUNT(*) DESC")
for row in cur.fetchall():
    print(f'  {row[0]}: {row[1]}')

# Sample a few records to understand payload structure
print('\n=== Sample records (first 3) ===')
cur.execute("SELECT id, status, paper_title, cation, anion, substrate, cof, temp_k, load_n, payload FROM records LIMIT 3")
for row in cur.fetchall():
    print(f'\nID: {row[0]}')
    print(f'Status: {row[1]}')
    print(f'Title: {row[2]}')
    print(f'Cation: {row[3]}, Anion: {row[4]}, Substrate: {row[5]}')
    print(f'COF: {row[6]}, Temp: {row[7]}K, Load: {row[8]}N')
    if row[9]:
        try:
            payload = json.loads(row[9])
            print(f'Payload keys: {list(payload.keys())[:10]}')
        except:
            print(f'Payload (raw): {str(row[9])[:200]}')

# Check sources table
print('\n=== sources sample ===')
cur.execute("SELECT id, filename, page_count, created_at FROM sources LIMIT 5")
for row in cur.fetchall():
    print(f'  {row[0]} | {row[1]} | pages={row[2]} | {row[3]}')

conn.close()
