import os
import sys
import django

sys.path.append('.')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from core.models import ActivityLog
from django.utils import timezone
from datetime import timedelta

# Look for fingerprints mismatch logs
logs = ActivityLog.objects.filter(
    description__icontains='fingerprint mismatch'
).order_by('-created_at')[:20]

print(f"Found {len(logs)} fingerprint mismatch logs:")
for log in logs:
    print(f"Time: {log.created_at} | User: {log.user} | Desc: {log.description}")
    print("-" * 20)

# Look for session limit hit logs
logs = ActivityLog.objects.filter(
    description__icontains='Limit hit'
).order_by('-created_at')[:20]

print(f"\nFound {len(logs)} session limit hit logs:")
for log in logs:
    print(f"Time: {log.created_at} | User: {log.user} | Desc: {log.description}")
    print("-" * 20)


# Also look for recent logouts
logs = ActivityLog.objects.filter(
    action='logout',
    created_at__gte=timezone.now() - timedelta(hours=2)
).order_by('-created_at')[:20]

print(f"\nRecent logouts (last 2 hours): {len(logs)}")
for log in logs:
    print(f"Time: {log.created_at}")
    print(f"User: {log.user}")
    print(f"Desc: {log.description}")
    print("-" * 20)
