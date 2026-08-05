from django.db import connection
from datetime import datetime, timezone

migrations_to_fake = [
    ('core', '0090_alter_user_role_photographer_and_more'),
]

with connection.cursor() as cursor:
    for app, name in migrations_to_fake:
        cursor.execute("SELECT id FROM django_migrations WHERE app = %s AND name = %s", [app, name])
        if not cursor.fetchone():
            cursor.execute(
                "INSERT INTO django_migrations (app, name, applied) VALUES (%s, %s, %s)",
                [app, name, datetime.now(timezone.utc)]
            )
            print(f"Inserted fake record for {app}.{name}")
        else:
            print(f"Already applied {app}.{name}")
