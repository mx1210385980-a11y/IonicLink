import sqlite3
import os

db_path = r'D:\Julyanffzz\Project\ioniclink\data\tribology.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cur.fetchall()
print('=== Tables in tribology.db ===')
for t in tables:
    tname = t[0]
    print(f'\n--- {tname} ---')
    cur.execute(f'PRAGMA table_info("{tname}")')
    cols = cur.fetchall()
    for c in cols:
        print(f'  {c[1]} ({c[2]})')
    cur.execute(f'SELECT COUNT(*) FROM "{tname}"')
    cnt = cur.fetchone()[0]
    print(f'  -> {cnt} rows')

conn.close()
