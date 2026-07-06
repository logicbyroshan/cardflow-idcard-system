import os
import sys
import re

# Set up Django environment
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django
django.setup()

from django.db import transaction
from django.contrib.auth import get_user_model
from assistants.models import Assistant
from client.models import Client
from idcards.models import IDCardGroup, IDCardTable, IDCard

User = get_user_model()

def repair():
    print("Starting database repair and inspection for Assistants...")
    print("=" * 80)
    
    assistants = Assistant.objects.select_related('user', 'client').prefetch_related('assigned_groups').all()
    clients = list(Client.objects.select_related('user').all())
    
    print(f"Found {len(assistants)} Assistant(s) and {len(clients)} Client(s) in the database.\n")
    
    for ast in assistants:
        # Only repair assistants created on July 4, 2026
        if not (ast.created_at.year == 2026 and ast.created_at.month == 7 and ast.created_at.day == 4):
            continue

        username = ast.user.username
        email = ast.user.email or ""
        name = ast.user.get_full_name() or username
        current_client_name = ast.client.name if ast.client else "None"
        
        print(f"Assistant: {name} (Email: {email})")
        print(f"  Current Client: {current_client_name} (ID: {ast.client_id})")
        
        # 1. Check and repair Client assignment
        target_client = ast.client
        if not target_client:
            print("  [Warning] Client is not assigned! Attempting to find correct Client...")
            # Try to match by email domain or acronym
            email_domain = email.split('@')[-1].lower() if '@' in email else ""
            
            # Simple matching logic
            matched_client = None
            for c in clients:
                c_name_clean = re.sub(r'[^a-zA-Z0-9]', '', c.name).lower()
                c_user_email = c.user.email or ""
                c_user_domain = c_user_email.split('@')[-1].lower() if '@' in c_user_email else ""
                
                # Match by email domain or name inclusion
                if email_domain and c_user_domain and email_domain == c_user_domain:
                    matched_client = c
                    break
                if email_domain and (email_domain in c_name_clean or c_name_clean in email_domain):
                    matched_client = c
                    break
            
            if matched_client:
                print(f"  [Fix] Found matching Client: {matched_client.name} (ID: {matched_client.id})")
                ast.client = matched_client
                ast.save(update_fields=['client'])
                target_client = matched_client
            else:
                print("  [Error] Could not find any matching Client automatically.")
        
        if not target_client:
            print("-" * 80)
            continue
            
        # 2. Check and repair class/section assignments
        if not ast.allowed_classes:
            print("  [Warning] No classes assigned! Attempting to parse from name/username...")
            # Examples: "12B", "10A", "NIRMAAN-F", "roshan NIRMAAN-F"
            # Remove acronym prefix if present
            clean_name = name
            for prefix in ["IPS", "IPS Seoni", "IPS Bhopal", target_client.name]:
                if clean_name.lower().startswith(prefix.lower()):
                    clean_name = clean_name[len(prefix):].strip()
            
            # Try to match regex patterns
            parsed_class = None
            parsed_section = None
            
            # Pattern 1: "12B" or "10A" (Number followed by letter)
            m1 = re.match(r'^(\d+)([a-zA-Z])$', clean_name)
            # Pattern 2: "NIRMAAN-F" (Name followed by hyphen and letter)
            m2 = re.match(r'^([a-zA-Z\s]+)-([a-zA-Z])$', clean_name)
            # Pattern 3: "AARAMBH-A"
            m3 = re.match(r'^([a-zA-Z\s\d]+)-([a-zA-Z])$', clean_name)
            
            if m1:
                parsed_class = m1.group(1)
                parsed_section = m1.group(2)
            elif m2:
                parsed_class = m2.group(1).strip()
                parsed_section = m2.group(2)
            elif m3:
                parsed_class = m3.group(1).strip()
                parsed_section = m3.group(2)
            else:
                # Fallback: check email prefix
                email_prefix = email.split('@')[0]
                m_email = re.match(r'^([a-zA-Z\s\d]+)-([a-zA-Z])$', email_prefix)
                if m_email:
                    parsed_class = m_email.group(1).strip()
                    parsed_section = m_email.group(2)
                else:
                    # Just treat the whole clean_name as class
                    parsed_class = clean_name
            
            if parsed_class:
                print(f"  Parsed class: '{parsed_class}' | Parsed section: '{parsed_section}'")
                
                # Verify if this class/section exists in the client's tables/cards
                # Get all tables for this client
                tables = IDCardTable.objects.filter(group__client=target_client, deleted_by_client=False)
                table_field_map = {}
                for table in tables:
                    class_field, section_field = None, None
                    for field in (table.fields or []):
                        ft = field.get('type', '').lower()
                        fn = field.get('name', '')
                        fn_lower = fn.lower()
                        if ft == 'class' or fn_lower == 'class':
                            class_field = fn
                        elif ft == 'section' or fn_lower == 'section':
                            section_field = fn
                    if class_field or section_field:
                        table_field_map[table.id] = {
                            'table': table,
                            'class_field': class_field,
                            'section_field': section_field
                        }
                
                # Check for cards matching the class/section
                matched_table_ids = set()
                matched_classes = set()
                matched_sections = set()
                
                for t_id, t_info in table_field_map.items():
                    c_f = t_info['class_field']
                    s_f = t_info['section_field']
                    
                    # Look for cards in this table
                    cards_qs = IDCard.objects.filter(table_id=t_id, deleted_at__isnull=True)
                    if c_f:
                        cards_qs = cards_qs.filter(**{f"field_data__{c_f}__iexact": parsed_class})
                    if s_f and parsed_section:
                        cards_qs = cards_qs.filter(**{f"field_data__{s_f}__iexact": parsed_section})
                        
                    if cards_qs.exists():
                        matched_table_ids.add(t_id)
                        matched_classes.add(parsed_class)
                        if parsed_section:
                            matched_sections.add(parsed_section)
                
                if matched_classes:
                    print(f"  [Fix] Found matching class database records! Assigning allowed_classes: {list(matched_classes)}, allowed_sections: {list(matched_sections)}")
                    ast.allowed_classes = list(matched_classes)
                    ast.allowed_sections = list(matched_sections)
                    
                    # Associate assigned groups & build scopes
                    groups = IDCardGroup.objects.filter(tables__id__in=matched_table_ids).distinct()
                    ast.assigned_groups.set(groups)
                    
                    # Build assignment scopes
                    scopes = []
                    for group in groups:
                        # Find tables in this group that matched
                        group_table_ids = [t.id for t in group.tables.all() if t.id in matched_table_ids]
                        for t_id in group_table_ids:
                            table_name = table_field_map[t_id]['table'].name
                            scopes.append({
                                'scope_type': 'table',
                                'scope_id': t_id,
                                'scope_name': table_name,
                                'group_id': group.id,
                                'group_name': group.name,
                                'classes': list(matched_classes),
                                'sections': list(matched_sections),
                                'branches': []
                            })
                    
                    ast.assignment_scopes = scopes
                    ast.save(update_fields=['allowed_classes', 'allowed_sections', 'assignment_scopes', 'assigned_table_ids'])
                    print(f"  [Fix] Restored scope assignments and linked to {len(groups)} group(s).")
                else:
                    print("  [Warning] No matching card records found in DB for this class/section. Using parsed values as fallback.")
                    ast.allowed_classes = [parsed_class]
                    if parsed_section:
                        ast.allowed_sections = [parsed_section]
                    ast.save(update_fields=['allowed_classes', 'allowed_sections'])
            else:
                print("  [Error] Could not parse class name from assistant name.")
                
        print("-" * 80)

if __name__ == "__main__":
    repair()
