import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import connection
from datetime import datetime, timezone

migrations = [
    ('mediafiles', '0001_create_cardmedia_model'),
    ('mediafiles', '0002_production_indexes'),
    ('mediafiles', '0003_cardmedia_file_index'),
    ('mediafiles', '0004_alter_cardmedia_media_type'),
    ('mediafiles', '0005_cardmedia_last_edited_by_role_cardmedia_root_token_and_more'),
    ('operators', '0002_operator_perm_manage_photographer_staff'),
    ('stats', '0002_add_server_load_alert'),
    ('stats', '0003_add_desktop_mobile_fields_to_snapshot'),
]

now = datetime.now(timezone.utc)
with connection.cursor() as cursor:
    for app, name in migrations:
        cursor.execute("SELECT id FROM django_migrations WHERE app = %s AND name = %s", [app, name])
        if not cursor.fetchone():
            cursor.execute(
                "INSERT INTO django_migrations (app, name, applied) VALUES (%s, %s, %s)",
                [app, name, now]
            )
            print(f"Inserted {app}.{name}")

print("Fake remaining migrations completed successfully!")
