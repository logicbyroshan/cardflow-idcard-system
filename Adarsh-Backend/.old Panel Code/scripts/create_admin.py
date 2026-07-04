import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model

User = get_user_model()

username = 'admin'
email = 'admin@example.com'
password = 'Password123!'

u = User.objects.filter(username=username).first()
if u:
    u.is_staff = True
    u.is_superuser = True
    u.set_password(password)
    u.save()
    print('updated')
else:
    User.objects.create_superuser(username, email, password)
    print('created')
