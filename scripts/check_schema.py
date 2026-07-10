import os
import re

script_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(script_dir) if os.path.basename(script_dir) == 'scripts' else os.path.abspath('.')
schema_path = os.path.join(root_dir, 'schema.sql')

schema = open(schema_path).read()
matches = re.findall(r'CREATE TABLE [^;]+REFERENCES "core_user"', schema)
for m in matches:
    print(re.search(r'CREATE TABLE "([^"]+)"', m).group(1))
print('--- staff_staff ---')
matches = re.findall(r'CREATE TABLE [^;]+REFERENCES "staff_staff"', schema)
for m in matches:
    print(re.search(r'CREATE TABLE "([^"]+)"', m).group(1))

