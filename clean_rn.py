import os, re

files = [
    'android_app/src/screens/HomeScreen.js',
    'android_app/src/screens/CardListScreen.js',
    'android_app/src/screens/ClientGroupsScreen.js',
    'android_app/src/screens/ClientsListScreen.js',
    'android_app/src/screens/GroupsScreen.js',
    'android_app/src/screens/GroupSettingsScreen.js',
    'android_app/src/screens/CardDetailScreen.js',
    'android_app/src/components/CardItem.js'
]

for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    if 'HomeScreen.js' in f:
        content = re.sub(r'\{ key: \'approved\',.*?\},\n?', '', content)
        content = re.sub(r'\{ key: \'download\',.*?\},\n?', '', content)
        content = re.sub(r'<ClientMiniStat label="APPROVED".*?/>\n?', '', content)
        content = re.sub(r'<ClientMiniStat label="DOWNLOAD".*?/>\n?', '', content)
        content = re.sub(r'approved:\s*\'perm_idcard_approved_list\',\n?', '', content)
        content = re.sub(r'download:\s*\'perm_idcard_download_list\',\n?', '', content)

    if 'CardListScreen.js' in f:
        content = re.sub(r'\{ key: \'approved\',.*?\},\n?', '', content)
        content = re.sub(r'\{ key: \'download\',.*?\},\n?', '', content)
        content = re.sub(r'approved:\s*\'perm_idcard_approved_list\',\n?', '', content)
        content = re.sub(r'download:\s*\'perm_idcard_download_list\',\n?', '', content)

    if 'ClientGroupsScreen.js' in f:
        content = re.sub(r'\{ key: \'approved\',.*?\},\n?', '', content)
        content = re.sub(r'\{ key: \'download\',.*?\},\n?', '', content)
        content = re.sub(r'counts\.approved \+=.*?\n?', '', content)
        content = re.sub(r'counts\.download \+=.*?\n?', '', content)
        content = content.replace('counts.approved + counts.download + ', '')
        content = content.replace('counts.all = counts.pending + counts.verified + counts.approved + counts.download + counts.pool;', 'counts.all = counts.pending + counts.verified + counts.pool;')
        content = content.replace('approved: { bg: \'#eff6ff\', text: \'#3b82f6\', border: \'#dbeafe\', icon: \'thumbs-up\' },', '')
        content = content.replace('download: { bg: \'#fef2f2\', text: \'#ef4444\', border: \'#fee2e2\', icon: \'download\' },', '')

    if 'ClientsListScreen.js' in f:
        content = re.sub(r'<StatPill label="APPROVED".*?/>\n?', '', content)
        content = re.sub(r'<StatPill label="DOWNLOAD".*?/>\n?', '', content)
        content = re.sub(r'const handleApprovedPress = useCallback\(.*?;\n?', '', content)
        content = re.sub(r'const handleDownloadPress = useCallback\(.*?;\n?', '', content)

    if 'GroupsScreen.js' in f:
        content = re.sub(r'\{ key: \'a\',.*?status: \'approved\'.*?\},\n?', '', content)
        content = re.sub(r'\{ key: \'d\',.*?status: \'download\'.*?\},\n?', '', content)
        content = re.sub(r'a:\s*table\.approved_cards.*?\n?', '', content)
        content = re.sub(r'd:\s*table\.download_cards.*?\n?', '', content)

    if 'GroupSettingsScreen.js' in f:
        content = content.replace('\'pending\', \'verified\', \'approved\', \'download\', \'pool\'', '\'pending\', \'verified\', \'pool\'')

    if 'CardDetailScreen.js' in f:
        content = content.replace('\'approved\', \'download\', \'pool\'', '\'pool\'')
        content = re.sub(r'\{ key: \'approved\'.*?\},\n?', '', content)
        content = re.sub(r'\{ key: \'download\'.*?\},\n?', '', content)

    if 'CardItem.js' in f:
        content = re.sub(r'\{\/\* Approved List Action Button \*\/\}.*?isClient && \(\s*<ActionItem.*?\'approved\'\)}\s*\/>\s*\)\}\s*', '', content, flags=re.DOTALL)
        content = re.sub(r'\{\/\* Download List Action Button \*\/\}.*?isClient && \(\s*<ActionItem.*?\'download\'\)}\s*\/>\s*\)\}\s*', '', content, flags=re.DOTALL)

    with open(f, 'w', encoding='utf-8') as file:
        file.write(content)
