"""
Management command to set up Admin Staff permissions in Django.
Run this once after initial migration:
    python manage.py setup_admin_staff_permissions
"""
from django.core.management.base import BaseCommand
from django.contrib.contenttypes.models import ContentType
from django.contrib.auth.models import Permission, Group

from core.models import User
from staff.services import ADMIN_STAFF_PERMISSIONS, ADMIN_STAFF_GROUP


class Command(BaseCommand):
    help = 'Set up Django permissions for Admin Staff'
    
    def handle(self, *args, **options):
        self.stdout.write('Setting up admin staff permissions...\n')
        
        # Get content type for User model
        content_type = ContentType.objects.get_for_model(User)
        
        created_count = 0
        existing_count = 0
        
        self.stdout.write('\nAdmin Staff Permissions:')
        
        for codename, name in ADMIN_STAFF_PERMISSIONS.items():
            permission, created = Permission.objects.get_or_create(
                codename=codename,
                content_type=content_type,
                defaults={'name': name}
            )
            
            if created:
                created_count += 1
                self.stdout.write(self.style.SUCCESS(f'  [CREATED] {codename}: {name}'))
            else:
                existing_count += 1
                self.stdout.write(f'  [EXISTS] {codename}: {name}')
        
        # Create the admin staff group
        self.stdout.write('\nAdmin Staff Group:')
        group, created = Group.objects.get_or_create(name=ADMIN_STAFF_GROUP)
        if created:
            self.stdout.write(self.style.SUCCESS(f'  [CREATED] {ADMIN_STAFF_GROUP}'))
        else:
            self.stdout.write(f'  [EXISTS] {ADMIN_STAFF_GROUP}')
        
        self.stdout.write('\n' + '=' * 50)
        self.stdout.write(f'\nDone! Created: {created_count}, Already existing: {existing_count}')
        self.stdout.write(f'Total permissions: {len(ADMIN_STAFF_PERMISSIONS)}')
