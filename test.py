from core.models import User
from client.services_staff import ClientStaffService
from client.models import Staff

user = User.objects.filter(role='client_staff').first()
if user:
    staff = user.staff_profile
    print(f"BEFORE: table_ids={staff.assigned_table_ids}, groups={list(staff.assigned_groups.values_list('id', flat=True))}, scopes={staff.assignment_scopes}")
    
    # Try unassigning everything
    admin_user = User.objects.filter(role='client').first()
    payload = {
        'assigned_groups': [],
        'assignment_id_source': 'table',
        'assignment_scopes': []
    }
    ClientStaffService.update_staff(admin_user, staff.id, payload)
    
    staff.refresh_from_db()
    print(f"AFTER: table_ids={staff.assigned_table_ids}, groups={list(staff.assigned_groups.values_list('id', flat=True))}, scopes={staff.assignment_scopes}")
else:
    print("No client_staff found.")
