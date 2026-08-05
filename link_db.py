import os
import sys
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from django.db import connection
from client.models import Client
from idcards.models import IDCardGroup, IDCardTable

User = get_user_model()

print("=== 1. ENSURING TABLES & COLUMNS IN POSTGRESQL ===")
with connection.cursor() as cursor:
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS core_idcardgroup (
            id SERIAL PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            description TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            client_id INT NOT NULL REFERENCES core_client(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS core_idcardtable (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            table_type VARCHAR(20) NOT NULL DEFAULT 'custom',
            fields JSONB NOT NULL DEFAULT '[]'::jsonb,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            deleted_by_client BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE core_idcardtable ADD COLUMN IF NOT EXISTS group_id INT REFERENCES core_idcardgroup(id) ON DELETE CASCADE;
        ALTER TABLE core_idcardtable ADD COLUMN IF NOT EXISTS table_type VARCHAR(20) DEFAULT 'custom';
        ALTER TABLE core_idcardtable ADD COLUMN IF NOT EXISTS deleted_by_client BOOLEAN DEFAULT FALSE;
    """)

print("=== 2. FETCHING MATHURA DAS SCHOOL OF EXCELLENCE ===")
org = Client.objects.filter(name__icontains="Mathura").first() or Client.objects.first()
print(f"Target Active Organisation: ID={org.id}, Name='{org.name}'")

# Ensure all IDCardGroup objects belong to org
groups = list(IDCardGroup.objects.all())
if not groups:
    default_group = IDCardGroup.objects.create(client=org, name=f"Default Group - {org.name}")
    groups = [default_group]
    print(f"Created Default Group: {default_group.name}")
else:
    default_group = groups[0]
    for g in groups:
        if g.client != org:
            print(f"Updating Group #{g.id} ({g.name}) client -> '{org.name}'")
            g.client = org
            g.save()

# Ensure all IDCardTable objects belong to default_group
tables = list(IDCardTable.objects.all())
for t in tables:
    if not t.group_id or not t.group or t.group.client != org:
        print(f"Updating Table #{t.id} ({t.name}) group -> '{default_group.name}' ('{org.name}')")
        t.group = default_group
        t.save()

print("\n=== VERIFICATION RESULTS ===")
print(f"Active Client in DB: ID={org.id}, Name='{org.name}'")
for t in IDCardTable.objects.all():
    c_name = t.group.client.name if (t.group and t.group.client) else 'NO CLIENT'
    print(f"  Table #{t.id} ({t.name}) ===> Linked Organisation: '{c_name}'")
