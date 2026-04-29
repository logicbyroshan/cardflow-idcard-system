from core.models import User
from idcards.models import IDCard, IDCardTable, IDCardGroup
from staff.models import Staff
from client.models import Client
from core.views.idcard_helpers import _apply_client_staff_row_scope

def verify_fix():
    print("--- Verifying Scoping Fixes ---")
    
    # Setup
    client_user, _ = User.objects.get_or_create(username='test_client_fix', role='client')
    client, _ = Client.objects.get_or_create(user=client_user, name='Fix Client')
    group, _ = IDCardGroup.objects.get_or_create(client=client, name='Fix Group')
    table = IDCardTable.objects.create(
        group=group, name='Fix Table',
        fields=[{'name': 'Class', 'type': 'class'}, {'name': 'Section', 'type': 'section'}]
    )
    
    # 1. Test Case-Insensitive JSON Keys
    print("\nTesting Case-Insensitive JSON Keys...")
    # These should all match if we are allowed "1st" class
    IDCard.objects.create(table=table, field_data={'Class': '1st', 'Section': 'A'})
    IDCard.objects.create(table=table, field_data={'class': '1st', 'Section': 'A'})
    IDCard.objects.create(table=table, field_data={'CLASS': '1st', 'Section': 'A'})
    
    staff_user, _ = User.objects.get_or_create(username='test_staff_fix', role='client_staff')
    staff_profile, _ = Staff.objects.get_or_create(user=staff_user, client=client, staff_type='client_staff')
    staff_profile.allowed_classes = ['1st']
    staff_profile.allowed_sections = ['A']
    staff_profile.assignment_scopes = []
    staff_profile.save()
    
    qs = IDCard.objects.filter(table=table)
    scoped = _apply_client_staff_row_scope(qs, staff_user, table)
    print(f"Expected 3 cards with different key cases, found: {scoped.count()}")
    for c in scoped:
        print(f"  - {c.field_data}")

    # 2. Test Multiple Scope Union (OR logic)
    print("\nTesting Multiple Scope Union (OR logic)...")
    # Scope 1: Class 1, Section A
    # Scope 2: Class 2, Section B
    staff_profile.assignment_scopes = [
        {'scope_type': 'table', 'scope_id': table.id, 'classes': ['1st'], 'sections': ['A']},
        {'scope_type': 'table', 'scope_id': table.id, 'classes': ['2nd'], 'sections': ['B']}
    ]
    staff_profile.save()
    
    # Students that SHOULD be visible
    IDCard.objects.create(table=table, field_data={'Class': '1st', 'Section': 'A'}) # Matches Scope 1
    IDCard.objects.create(table=table, field_data={'Class': '2nd', 'Section': 'B'}) # Matches Scope 2
    
    # Student that SHOULD NOT be visible (Class 1 but wrong Section for Class 1)
    IDCard.objects.create(table=table, field_data={'Class': '1st', 'Section': 'B'}) # Matches (1st, B) - NOT in Scope 1 or 2
    
    scoped = _apply_client_staff_row_scope(qs, staff_user, table)
    print(f"Scoped cards found: {scoped.count()}")
    for c in scoped:
        print(f"  - {c.field_data}")
    
    has_wrong = scoped.filter(field_data__Class='1st', field_data__Section='B').exists()
    print(f"Incorrect card (1st, B) visible? {has_wrong}")
    
    # Cleanup
    table.delete()
    group.delete()
    client.delete()
    client_user.delete()
    staff_user.delete()

if __name__ == "__main__":
    verify_fix()
