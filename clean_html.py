import os, glob

files = [
    r'templates\client\cards.html',
    r'templates\client\dashboard.html',
    r'templates\partials\client\client-drawer.html',
    r'templates\partials\client-sidebar.html',
    r'templates\partials\idcard\topbar.html',
    r'templates\partials\idcard-group\table.html',
    r'templates\partials\sidebar.html',
    r'templates\partials\staff\client-staff-drawer.html',
    r'templates\partials\staff\staff-drawer-permissions.html',
    r'templates\partials\unified-sidebar.html'
]

for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # 1. cards.html
    content = content.replace('{% if perm_idcard_approved_list %}<option value="approved">Approved</option>{% endif %}', '')
    content = content.replace('{% if perm_idcard_download_list %}<option value="download">Download</option>{% endif %}', '')

    # 2. client-drawer.html
    content = content.replace('<div class="permission-row">\n                      <input type="checkbox" id="perm_idcard_approved_list" name="perm_idcard_approved_list">\n                      <span class="permission-label">Approved List</span>\n                    </div>', '')
    content = content.replace('<div class="permission-row">\n                      <input type="checkbox" id="perm_idcard_download_list" name="perm_idcard_download_list">\n                      <span class="permission-label">Download List</span>\n                    </div>', '')

    # 3. staff-drawer-permissions.html
    content = content.replace('<label class="perm-card">\n                    <input type="checkbox" name="perm_idcard_approved_list" id="perm-idcard-approved-list">\n                    <span class="perm-name">Approved List</span>\n                </label>', '')
    content = content.replace('<label class="perm-card">\n                    <input type="checkbox" name="perm_idcard_download_list" id="perm-idcard-download-list">\n                    <span class="perm-name">Download List</span>\n                </label>', '')
    
    # topbar.html & group/table.html
    content = content.replace('{% if is_super_admin or perm_idcard_approved_list %}', '{% if is_super_admin %}')
    content = content.replace('{% if is_super_admin or perm_idcard_download_list %}', '{% if is_super_admin %}')

    # sidebar ifs
    content = content.replace(' or perm_idcard_approved_list or perm_idcard_download_list', '')

    with open(f, 'w', encoding='utf-8') as file:
        file.write(content)
