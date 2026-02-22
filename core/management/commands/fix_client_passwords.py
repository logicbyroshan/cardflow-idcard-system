"""
Management command to reset client & client_staff passwords to their phone numbers.
This fixes accounts that were created with random passwords but told users
to log in with their mobile number.

Usage:
    python manage.py fix_client_passwords          # Dry run (shows what would change)
    python manage.py fix_client_passwords --apply   # Actually apply changes
"""
from django.core.management.base import BaseCommand
from core.models import User


class Command(BaseCommand):
    help = 'Reset client/client_staff passwords to their phone numbers'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Actually apply password changes (default is dry run)',
        )

    def handle(self, *args, **options):
        apply = options['apply']
        
        users = User.objects.filter(
            role__in=['client', 'client_staff'],
            is_active=True,
        ).exclude(phone='').exclude(phone__isnull=True)

        count = users.count()
        self.stdout.write(f'Found {count} active client/client_staff users with phone numbers.')

        if not apply:
            self.stdout.write(self.style.WARNING(
                'DRY RUN — no changes made. Use --apply to reset passwords.'
            ))

        updated = 0
        skipped = 0
        for user in users:
            phone = user.phone.strip()
            if not phone:
                skipped += 1
                continue

            if apply:
                user.set_password(phone)
                user.save(update_fields=['password'])
                self.stdout.write(f'  ✓ {user.email} ({user.role}) → password set to phone')
            else:
                self.stdout.write(f'  [dry] {user.email} ({user.role}) → would reset to phone')
            updated += 1

        self.stdout.write('')
        if apply:
            self.stdout.write(self.style.SUCCESS(f'Done! {updated} passwords updated, {skipped} skipped.'))
        else:
            self.stdout.write(self.style.WARNING(
                f'{updated} would be updated, {skipped} would be skipped. Run with --apply to execute.'
            ))
