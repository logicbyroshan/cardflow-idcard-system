import re
from collections import Counter

content = open('officework/static/officework/js/office-work.js', 'r', encoding='utf-8').read()
# Find function definitions: function name(...) or name = function(...)
funcs = re.findall(r'function\s+([a-zA-Z0-9_]+)\s*\(', content)
vars = re.findall(r'var\s+([a-zA-Z0-9_]+)', content)
lets = re.findall(r'let\s+([a-zA-Z0-9_]+)', content)
consts = re.findall(r'const\s+([a-zA-Z0-9_]+)', content)

all_defs = funcs + vars + lets + consts
counts = Counter(all_defs)
for name, count in counts.items():
    if count > 1:
        # Check if it's actually redefined in the same scope (hard without parser, but let's see)
        print(f'Possible duplicate definition: {name} ({count} times)')
