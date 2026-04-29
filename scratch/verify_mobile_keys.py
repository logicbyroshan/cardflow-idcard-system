import os
import django
import json
from django.test import RequestFactory
from django.http import JsonResponse

# Setup Django
import sys
sys.path.append(os.getcwd())
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from mobile_app.views import api_dashboard_data
from core.models import User
from client.models import Client
from idcards.models import IDCardGroup, IDCardTable, IDCard

def verify_dashboard_keys():
    print("Verifying Dashboard API keys...")
    
    # Get or create a test client
    client = Client.objects.filter(status='active').first()
    if not client:
        print("No active client found in DB. Skipping verification.")
        return

    # Find a user for this client
    user = User.objects.filter(role='client', client_profile=client).first()
    if not user:
        # Create a temp user if needed
        print("No client user found. Creating a temporary one.")
        user = User.objects.create_user(username='test_mobile_verify', password='password', role='client')
        user.client_profile = client
        user.save()

    # Mock request
    rf = RequestFactory()
    request = rf.get('/app/api/dashboard/')
    request.user = user
    request.headers = {'X-Mobile-Shell': 'true'} # bypass require_mobile_client if needed

    # Call view
    response = api_dashboard_data(request)
    data = json.loads(response.content)

    if data.get('success'):
        tables = data.get('data', {}).get('tables', [])
        if tables:
            table = tables[0]
            print(f"Sample table keys: {list(table.keys())}")
            expected = {'id', 'name', 'p', 'v', 'a', 'd', 'po'}
            actual = set(table.keys())
            if expected.issubset(actual):
                print("✅ Dashboard keys match frontend expectations (p, v, a, d).")
            else:
                print(f"❌ Missing keys! Expected at least {expected}, got {actual}")
        else:
            print("⚠️ No tables found for this client. Cannot verify keys.")
    else:
        print(f"❌ API call failed: {data.get('message')}")

if __name__ == "__main__":
    verify_dashboard_keys()
