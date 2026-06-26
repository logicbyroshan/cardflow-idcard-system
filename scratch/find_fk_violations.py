import os
import django
import sys
import sqlite3

sys.path.append('c:/Users/iamro/Desktop/Adarsh FInal Deploye')
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from staff.models import Staff
from django.db import transaction, connection

staff = Staff.objects.filter(staff_type='admin_staff').first()
user = staff.user

try:
    with transaction.atomic():
        staff.delete()
        user.delete()
        
        with connection.cursor() as cursor:
            cursor.execute("PRAGMA foreign_key_check;")
            violations = cursor.fetchall()
            print("Foreign key violations before commit:", violations)
except Exception as e:
    print("Exception:", type(e), e)
