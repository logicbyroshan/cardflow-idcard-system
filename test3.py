from core.models import User, Staff
from client.services_staff import ClientStaffService
import json

staff = Staff.objects.first()
client = staff.client

data = {'assigned_groups': []}

# COPY LOGIC FROM services_staff.py
scopes_raw = data.get('assignment_scopes')
normalized_assignment_scopes = None
scope_group_ids, scope_table_ids = [], []

if isinstance(scopes_raw, list):
    normalized_assignment_scopes = []
    # simulate parsing
    
resolved_group_ids = list(staff.assigned_groups.values_list('id', flat=True))
resolved_table_ids = [
    int(v) for v in (staff.assigned_table_ids or [])
    if str(v).strip().isdigit() and int(v) > 0
]
print("1. resolved_table_ids:", resolved_table_ids)

if ('assigned_groups' in data) or (normalized_assignment_scopes is not None):
    explicit_assignment_payload = 'assigned_groups' in data
    assignment_ids = data.get('assigned_groups', [])
    if (not assignment_ids) and normalized_assignment_scopes:
        assignment_ids = scope_group_ids

    print("explicit_assignment_payload:", explicit_assignment_payload)
    print("assignment_ids:", assignment_ids)
    print("normalized_assignment_scopes:", normalized_assignment_scopes)

    if assignment_ids:
        print("branch: assignment_ids")
    elif explicit_assignment_payload and not normalized_assignment_scopes:
        print("branch: elif explicit_assignment_payload and not normalized_assignment_scopes")
        resolved_group_ids, resolved_table_ids = [], []

    print("2. resolved_table_ids:", resolved_table_ids)

    if normalized_assignment_scopes:
        print("branch: normalized_assignment_scopes")
        resolved_group_ids = sorted(set(resolved_group_ids) | set(scope_group_ids))
        resolved_table_ids = sorted(set(resolved_table_ids) | set(scope_table_ids))

    print("3. resolved_table_ids:", resolved_table_ids)
    
    staff.assigned_table_ids = resolved_table_ids
    staff.save(update_fields=['assigned_table_ids'])

staff.refresh_from_db()
print("FINAL:", staff.assigned_table_ids)
