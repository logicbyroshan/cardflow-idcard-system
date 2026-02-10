"""
Management command to set up client staff permissions.

Usage:
    python manage.py setup_client_staff_permissions
    
This creates all the Django Permission objects needed for client staff.
"""
from django.core.management.base import BaseCommand
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType

from core.models import User
from client_staff.services import (
    CLIENT_STAFF_PERMISSIONS,
    CLIENT_ADMIN_ONLY_PERMISSIONS,
    ClientStaffPermissionService,
)


class Command(BaseCommand):
    help = 'Set up Django permissions for client staff'
    
    def handle(self, *args, **options):
        self.stdout.write('Setting up client staff permissions...\n')
        
        # Get content type for User model
        content_type = ContentType.objects.get_for_model(User)
        
        created_count = 0
        existing_count = 0
        
        # Create client staff permissions
        self.stdout.write('\nClient Staff Permissions:')
        for codename, name in CLIENT_STAFF_PERMISSIONS.items():
            perm, created = Permission.objects.get_or_create(
                codename=codename,
                content_type=content_type,
                defaults={'name': name}
            )
            
            if created:
                self.stdout.write(self.style.SUCCESS(f'  [CREATED] {codename}: {name}'))
                created_count += 1
            else:
                self.stdout.write(f'  [EXISTS]  {codename}: {name}')
                existing_count += 1
        
        # Create client admin only permissions
        self.stdout.write('\nClient Admin Only Permissions:')
        for codename, name in CLIENT_ADMIN_ONLY_PERMISSIONS.items():
            perm, created = Permission.objects.get_or_create(
                codename=codename,
                content_type=content_type,
                defaults={'name': name}
            )
            
            if created:
                self.stdout.write(self.style.SUCCESS(f'  [CREATED] {codename}: {name}'))
                created_count += 1
            else:
                self.stdout.write(f'  [EXISTS]  {codename}: {name}')
                existing_count += 1
        
        self.stdout.write('\n' + '=' * 50)
        self.stdout.write(self.style.SUCCESS(
            f'\nDone! Created: {created_count}, Already existing: {existing_count}'
        ))
        self.stdout.write(
            f'Total permissions: {created_count + existing_count}\n'
        )
