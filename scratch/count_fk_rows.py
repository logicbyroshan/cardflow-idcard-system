import sqlite3

user_id = 3
conn = sqlite3.connect('c:/Users/iamro/Desktop/Adarsh FInal Deploye/db.sqlite3')
cur = conn.cursor()

# Get all tables
cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = cur.fetchall()

print(f"Counting related rows for user_id={user_id}")
for table in tables:
    table_name = table[0]
    cur.execute(f"PRAGMA foreign_key_list('{table_name}');")
    fks = cur.fetchall()
    for fk in fks:
        if fk[2] == 'core_user':
            col = fk[3]
            try:
                cur.execute(f"SELECT COUNT(*) FROM {table_name} WHERE {col} = ?", (user_id,))
                count = cur.fetchone()[0]
                if count > 0:
                    print(f"Table: {table_name}, Column: {col}, Count: {count}")
            except Exception as e:
                print(f"Error querying {table_name}.{col}: {e}")

conn.close()
