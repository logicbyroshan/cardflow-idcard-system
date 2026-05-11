import os
import django
import sys

# Setup Django environment
sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from core.models import Notification

def create_sample():
    # Create a broadcast notification
    n = Notification.objects.create(
        title="Welcome to Adarsh Mobile!",
        message="Experience premium ID card management right from your pocket. Your notifications are now working correctly.",
        priority='normal',
        category='announcement',
        target='all',
        is_active=True
    )
    print(f"Created sample notification ID: {n.id}")

if __name__ == "__main__":
    create_sample()
