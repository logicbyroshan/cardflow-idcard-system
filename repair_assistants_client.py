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
    
    repaired_count = 0
    skipped_count = 0
    
    for ast in assistants:
        # Only repair assistants created on July 4, 2026
        if not (ast.created_at.year == 2026 and ast.created_at.month == 7 and ast.created_at.day == 4):
            skipped_count += 1
            continue

        username = ast.user.username
        email = ast.user.email or ""
        name = ast.user.get_full_name() or username
        current_client_name = ast.client.name if ast.client else "None"
        
        print(f"Assistant: {name} (Email: {email})")
        print(f"  Current Client: {current_client_name} (ID: {ast.client_id})")
        
        # 1. Check and repair Client assignment
        target_client = ast.client
        client_changed = False
        
        # Calculate matching score for all clients to verify/re-assign
        best_client = None
        best_score = 0
        
        email_clean = email.lower().strip()
        email_domain = email_clean.split('@')[-1] if '@' in email_clean else ""
        domain_prefix = email_domain.split('.')[0] if email_domain else ""
        
        # We only try to match if domain prefix is not a common provider
        is_school_domain = domain_prefix and domain_prefix not in ('gmail', 'yahoo', 'outlook', 'hotmail', 'mail', 'live', 'icloud', 'protonmail', 'zoho', 'yandex')
        
        if is_school_domain:
            for c in clients:
                c_name = c.name.lower()
                c_user_email = (c.user.email or "").lower()
                
                score = 0
                # Perfect domain match
                if c_user_email and c_user_email.split('@')[-1] == email_domain:
                    score += 100
                
                # Check initials of the client name
                # E.g. "International Public School (Seoni) IPS Seoni" -> initials can form "ipss" or contain "ips" & "seoni"
                c_name_clean = re.sub(r'[^a-z0-9\s]', ' ', c_name)
                words = [w.strip() for w in c_name_clean.split() if w.strip()]
                initials = "".join([w[0] for w in words if w])
                
                if domain_prefix == initials:
                    score += 90
                elif domain_prefix in c_name:
                    score += 70
                else:
                    # Check if initials of a prefix match domain_prefix
                    # E.g. "International Public School Seoni" -> "ipss"
                    for i in range(2, len(words) + 1):
                        sub_initials = "".join([w[0] for w in words[:i] if w])
                        if domain_prefix == sub_initials:
                            score += 80
                            break
                            
                # Check word inclusion
                matched_words = 0
                for w in words:
                    if len(w) >= 3 and w in domain_prefix:
                        matched_words += 1
                if matched_words > 0:
                    score += matched_words * 15
                    
                if score > best_score:
                    best_score = score
                    best_client = c

        # Determine if we should change/assign the client
        current_score = 0
        if target_client and is_school_domain:
            c_name = target_client.name.lower()
            c_name_clean = re.sub(r'[^a-z0-9\s]', ' ', c_name)
            words = [w.strip() for w in c_name_clean.split() if w.strip()]
            initials = "".join([w[0] for w in words if w])
            if domain_prefix == initials:
                current_score += 90
            elif domain_prefix in c_name:
                current_score += 70
            for w in words:
                if len(w) >= 3 and w in domain_prefix:
                    current_score += 15

        if best_client and best_score >= 30:
            if not target_client or (target_client.id != best_client.id and current_score < 30):
                print(f"  [Fix] Re-assigning Client: '{current_client_name}' (ID: {ast.client_id}) -> '{best_client.name}' (ID: {best_client.id}) [Match Score: {best_score}]")
                ast.client = best_client
                ast.save(update_fields=['client'])
                target_client = best_client
                current_client_name = best_client.name
                client_changed = True
        
        if not target_client:
            print("  [Error] No client found or matched for this assistant.")
            print("-" * 80)
            continue
            
        # 2. Check and repair class/section assignments
        # We run this if classes are empty OR if the client was just changed/corrected
        if not ast.allowed_classes or client_changed:
            print("  Attempting to parse and restore class/section assignments...")
            # Examples: "12B", "10A", "NIRMAAN-F", "roshan NIRMAAN-F"
            # Remove acronym prefixes from name
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
                m_email_num = re.match(r'^(\d+)([a-zA-Z])$', email_prefix)
                if m_email:
                    parsed_class = m_email.group(1).strip()
                    parsed_section = m_email.group(2)
                elif m_email_num:
                    parsed_class = m_email_num.group(1)
                    parsed_section = m_email_num.group(2)
                else:
                    # Just treat the whole clean_name as class
                    parsed_class = clean_name
            
            if parsed_class:
                print(f"  Parsed class: '{parsed_class}' | Parsed section: '{parsed_section}'")
                
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
                    print(f"  [Success] Restored scope assignments and linked to {len(groups)} group(s).")
                    repaired_count += 1
                else:
                    print("  [Warning] No matching card records found in DB for this class/section. Using parsed values as fallback.")
                    ast.allowed_classes = [parsed_class]
                    if parsed_section:
                        ast.allowed_sections = [parsed_section]
                    ast.save(update_fields=['allowed_classes', 'allowed_sections'])
                    repaired_count += 1
            else:
                print("  [Error] Could not parse class name from assistant name.")
                
        print("-" * 80)
        
    print(f"\nRepair complete. Repaired/Updated: {repaired_count} assistant(s). Skipped: {skipped_count} assistant(s).")

if __name__ == "__main__":
    repair()
