import sqlite3
conn = sqlite3.connect('data/ioniclink.db')
c = conn.cursor()
c.execute("SELECT DISTINCT lubricant FROM tribology_data WHERE lower(lubricant) LIKE '%ethaline%' OR lower(lubricant) LIKE '%chcl%'")
print(c.fetchall())
conn.close()
