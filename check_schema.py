import re
schema = open('schema.sql').read()
matches = re.findall(r'CREATE TABLE [^;]+REFERENCES "core_user"', schema)
for m in matches:
    print(re.search(r'CREATE TABLE "([^"]+)"', m).group(1))
print('--- staff_staff ---')
matches = re.findall(r'CREATE TABLE [^;]+REFERENCES "staff_staff"', schema)
for m in matches:
    print(re.search(r'CREATE TABLE "([^"]+)"', m).group(1))

