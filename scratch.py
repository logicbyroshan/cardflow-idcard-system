import sys, os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()
from client.services_dashboard import ClientDashboardService
from core.models import User
user = User.objects.filter(role='client').first()
res = ClientDashboardService.get_dashboard_data(user)
print(len(res.data['recent_staff']))

