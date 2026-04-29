import os
import django
import sys

# Setup Django
sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Mock modules to avoid setup failures
class Mock:
    def __getattr__(self, name): return Mock() if name != '__path__' else []
    def __call__(self, *args, **kwargs): return self
    def __getitem__(self, key): return self
    def __iter__(self): return iter([])

sys.modules['dotenv'] = Mock()
sys.modules['dj_database_url'] = Mock()
sys.modules['whitenoise'] = Mock()
sys.modules['corsheaders'] = Mock()
sys.modules['channels'] = Mock()
sys.modules['channels.layers'] = Mock()
sys.modules['channels.auth'] = Mock()
sys.modules['channels.routing'] = Mock()
sys.modules['django_ratelimit'] = Mock()
sys.modules['django_ratelimit.decorators'] = Mock()

os.environ['SECRET_KEY'] = 'django-insecure-test-key-long-enough-to-pass-validation-1234567890'
os.environ['ALLOWED_HOSTS'] = '*'
os.environ['DATABASE_URL'] = 'sqlite:///db.sqlite3'
os.environ['REDIS_URL'] = 'redis://localhost:6379/0'

django.setup()

from core.models import User
from idcards.models import IDCard, IDCardTable, IDCardGroup
from staff.models import Staff
from client.models import Client
from core.views.idcard_helpers import _apply_client_staff_row_scope

def test_scoping():
    print("--- Starting Scoping Diagnostics ---")
    
    # 1. Create dummy data
    client_user, _ = User.objects.get_or_create(username='test_client_diag', role='client')
    client, _ = Client.objects.get_or_create(user=client_user, name='Diag Client')
    
    group, _ = IDCardGroup.objects.get_or_create(client=client, name='Diag Group')
    
    # Table with "Class" and "Section" fields
    table = IDCardTable.objects.create(
        group=group,
        name='Diag Table',
        fields=[
            {'name': 'Class', 'type': 'class'},
            {'name': 'Section', 'type': 'section'}
        ]
    )
    
    # Cards with different casing and data
    IDCard.objects.create(table=table, field_data={'Class': '1st', 'Section': 'A'}) # Normal
    IDCard.objects.create(table=table, field_data={'class': '1st', 'Section': 'A'}) # Lowercase key
    IDCard.objects.create(table=table, field_data={'Class': 'I', 'Section': 'A'})   # Roman numeral
    IDCard.objects.create(table=table, field_data={'Class': '2nd', 'Section': 'B'}) # Different class/sec
    IDCard.objects.create(table=table, field_data={'Class': '1st', 'Section': 'B'}) # Cross-over
    
    staff_user, _ = User.objects.get_or_create(username='test_staff_diag', role='client_staff')
    staff_profile, _ = Staff.objects.get_or_create(
        user=staff_user, 
        client=client, 
        staff_type='client_staff'
    )
    
    # Test Case 1: Assigned to Class "1st" and Section "A" (Single Scope)
    print("\nCase 1: Assigned to Class '1st' and Section 'A'")
    staff_profile.allowed_classes = ['1st']
    staff_profile.allowed_sections = ['A']
    staff_profile.assignment_scopes = [] # Use legacy fields
    staff_profile.save()
    
    qs = IDCard.objects.filter(table=table)
    scoped = _apply_client_staff_row_scope(qs, staff_user, table)
    print(f"Total cards: {qs.count()}")
    print(f"Scoped cards (expected 2): {scoped.count()}")
    for c in scoped:
        print(f"  - {c.field_data}")

    # Test Case 2: Inconsistent Key Case
    print("\nCase 2: Checking if 'class' (lowercase key) is found")
    found_lower = scoped.filter(field_data__has_key='class').exists()
    print(f"Card with 'class' key found: {found_lower}")

    # Test Case 3: Multiple Scopes (The "AND" Bug)
    print("\nCase 3: Assigned to (1st, A) AND (2nd, B)")
    # Current logic flattens this to classes=[1st, 2nd], sections=[A, B]
    staff_profile.allowed_classes = []
    staff_profile.allowed_sections = []
    staff_profile.assignment_scopes = [
        {'scope_type': 'table', 'scope_id': table.id, 'classes': ['1st'], 'sections': ['A']},
        {'scope_type': 'table', 'scope_id': table.id, 'classes': ['2nd'], 'sections': ['B']}
    ]
    staff_profile.save()
    
    scoped = _apply_client_staff_row_scope(qs, staff_user, table)
    print(f"Scoped cards (expected 2 if correct, 4 if bugged): {scoped.count()}")
    for c in scoped:
        print(f"  - {c.field_data}")

    # Cleanup
    table.delete()
    group.delete()
    client.delete()
    client_user.delete()
    staff_user.delete()

if __name__ == "__main__":
    test_scoping()
