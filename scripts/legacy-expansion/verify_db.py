import sqlite3

conn = sqlite3.connect(r'D:\Julyanffzz\Project\ioniclink\data\tribology.db')
c = conn.cursor()

c.execute('SELECT COUNT(*) FROM records')
print(f'Records: {c.fetchone()[0]}')

c.execute('SELECT COUNT(*) FROM sources')
print(f'Sources: {c.fetchone()[0]}')

c.execute('SELECT status, COUNT(*) FROM records GROUP BY status')
for row in c.fetchall():
    print(f'  {row[0]}: {row[1]}')

# Show recent records
c.execute('SELECT id, paper_title, cation, anion, cof FROM records ORDER BY id DESC LIMIT 5')
print('\nRecent 5 records:')
for row in c.fetchall():
    print(f'  {row[0]}: {str(row[1])[:50]} | {str(row[2])[:20]} | {str(row[3])[:20]} | cof={row[4]}')

conn.close()
