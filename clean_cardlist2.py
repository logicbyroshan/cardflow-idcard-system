import re

f = 'android_app/src/screens/CardListScreen.js'
with open(f, 'r', encoding='utf-8') as file:
    content = file.read()

# 1. STATUS_OPTIONS
content = re.sub(r'\{ key: \'approved\', label: \'Approved\',.*?\},\n\s*', '', content)
content = re.sub(r'\{ key: \'download\', label: \'Download\',.*?\},\n\s*', '', content)

# 2. permissions mapping
content = re.sub(r'approved: \'perm_idcard_approved_list\',\n\s*', '', content)
content = re.sub(r'download: \'perm_idcard_download_list\',\n\s*', '', content)

# 3. bulk status labels
block_1 = """    } else if (currentStatus === 'verified' && statusStr === 'approved') {
      title = 'Approve Selected Cards?'; icon = 'thumbs-up'; color = '#3b82f6';
      note  = `This will move ${selectedIds.size} selected records to Approved list.`;"""
content = content.replace(block_1, '')

block_2 = """    } else if (currentStatus === 'approved' && statusStr === 'verified') {
      title = 'Disapprove Selected Cards?'; icon = 'redo'; color = '#f59e0b';
      note  = `This will move ${selectedIds.size} selected records back to Verified list.`;"""
content = content.replace(block_2, '')

# 4. individual status labels
block_3 = """    } else if (currentStatus === 'verified' && statusStr === 'approved') {
      title = 'Approve Card?'; message = 'Are you sure you want to approve this record?';
      icon = 'thumbs-up'; color = '#3b82f6'; note = 'This will move the record to Approved list.';"""
content = content.replace(block_3, '')

block_4 = """    } else if (currentStatus === 'approved' && statusStr === 'verified') {
      title = 'Disapprove Card?'; message = 'Are you sure you want to move this record from Approved to Verified list?';
      icon = 'redo'; color = '#f59e0b'; note = 'This will move the record back to Verified list.';"""
content = content.replace(block_4, '')

# 5. hasItemAction check
block_5 = """    if (currentStatus === 'approved') {
      return !isClientRole && !!perms.perm_idcard_approve;
    }"""
content = content.replace(block_5, '')

# 6. statusChangeHandler check
content = content.replace("currentStatus === 'approved' ||\n      ", "")

# 7. Bottom Bulk Action Buttons
block_6 = "              {currentStatus === 'verified' && perms.perm_idcard_approve && <FBtn icon=\"check-double\" label=\"APPROVE SELECTED\" disabled={bulkLoading} onPress={() => handleBulkStatus('approved')} />}"
content = content.replace(block_6, "")

block_7 = "              {currentStatus === 'approved' && perms.perm_idcard_approve && !isClientRole && <FBtn icon=\"redo\"         label=\"DISAPPROVE SELECTED\" color=\"#f59e0b\" disabled={bulkLoading} onPress={() => handleBulkStatus('verified')} />}"
content = content.replace(block_7, "")

with open(f, 'w', encoding='utf-8') as file:
    file.write(content)
