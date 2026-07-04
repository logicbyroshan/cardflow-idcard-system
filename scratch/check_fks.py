import sqlite3

conn = sqlite3.connect('c:/Users/iamro/Desktop/Adarsh FInal Deploye/db.sqlite3')
cur = conn.cursor()

# Get all tables
cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = cur.fetchall()

print("Foreign Keys pointing to core_user:")
for table in tables:
    table_name = table[0]
    cur.execute(f"PRAGMA foreign_key_list('{table_name}');")
    fks = cur.fetchall()
    for fk in fks:
        # fk: id, seq, table, from, to, on_update, on_delete, match
        if fk[2] == 'core_user':
            print(f"Table: {table_name}, Column: {fk[3]}, On Delete: {fk[6]}")

conn.close()
