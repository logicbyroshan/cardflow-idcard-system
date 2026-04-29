import re
from collections import Counter

content = open('officework/templates/officework/office-work.html', 'r', encoding='utf-8').read()
ids = re.findall(r'id="([^"]+)"', content)
counts = Counter(ids)
for id, count in counts.items():
    if count > 1:
        print(f'Duplicate ID: {id} ({count} times)')
