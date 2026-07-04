import os
import django
import sys

sys.path.append('c:/Users/iamro/Desktop/Adarsh FInal Deploye')
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from staff.models import Staff
from django.contrib.admin.models import LogEntry
from core.models import User

staff = Staff.objects.filter(staff_type='admin_staff').first()
if not staff:
    print("No admin_staff found")
    sys.exit()

user = staff.user

links = [
    f for f in user._meta.get_fields() 
    if (f.one_to_many or f.one_to_one) and f.auto_created and not f.concrete
]

print("Related objects:")
for link in links:
    related_name = link.get_accessor_name()
    manager = getattr(user, related_name, None)
    if manager and hasattr(manager, 'all'):
        try:
            count = manager.all().count()
            if count > 0:
                print(f"  {related_name}: {count}")
        except Exception as e:
            pass

# Also check LogEntry
logs = LogEntry.objects.filter(user=user).count()
if logs > 0:
    print(f"  logentry: {logs}")

