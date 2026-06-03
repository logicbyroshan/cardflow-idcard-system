import re

f = 'android_app/src/screens/CardListScreen.js'
with open(f, 'r', encoding='utf-8') as file:
    content = file.read()

# Remove bulk operations logic
content = re.sub(r'\} else if \(currentStatus === \'verified\' && statusStr === \'approved\'\) \{.*?\'verified\'\) \{.*?\n\s*\}', '', content, flags=re.DOTALL)
content = re.sub(r'\} else if \(currentStatus === \'approved\' && statusStr === \'verified\'\) \{.*?\n\s*\}', '', content, flags=re.DOTALL)

# Remove the other occurrences
content = re.sub(r'\} else if \(currentStatus === \'verified\' && statusStr === \'approved\'\) \{.*?note = \'This will move the record to Approved list.\';\s*\n', '', content, flags=re.DOTALL)
content = re.sub(r'\} else if \(currentStatus === \'approved\' && statusStr === \'verified\'\) \{.*?title = \'Disapprove Card\?\'; message = \'Are you sure you want to move this record from Approved to Verified list\?\';\s*\n', '', content, flags=re.DOTALL)

content = re.sub(r'if \(currentStatus === \'approved\'\) \{.*?\}', '', content, flags=re.DOTALL)
content = content.replace('currentStatus === \'approved\' ||\n', '')
content = re.sub(r'\{currentStatus === \'verified\'.*?APPROVE SELECTED.*?/>\}\n', '', content)
content = re.sub(r'\{currentStatus === \'approved\'.*?DISAPPROVE SELECTED.*?/>\}\n', '', content)

with open(f, 'w', encoding='utf-8') as file:
    file.write(content)
