from django.core.management.base import BaseCommand
from django.utils import timezone

from datetime import timedelta

from mobile_app.models import MobileDevice


class Command(BaseCommand):
    help = "Mark stale mobile shell devices inactive and optionally purge old inactive records."

    def add_arguments(self, parser):
        parser.add_argument(
            '--stale-days',
            type=int,
            default=30,
            help='Mark active devices inactive when last_seen_at is older than this many days (default: 30).',
        )
        parser.add_argument(
            '--delete-days',
            type=int,
            default=120,
            help='Delete inactive devices when last_seen_at is older than this many days (default: 120).',
        )
        parser.add_argument(
            '--delete-inactive',
            action='store_true',
            help='Delete old inactive devices after marking stale records inactive.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show counts without writing changes.',
        )

    def handle(self, *args, **options):
        stale_days = max(1, int(options.get('stale_days') or 30))
        delete_days = max(stale_days, int(options.get('delete_days') or 120))
        delete_inactive = bool(options.get('delete_inactive'))
        dry_run = bool(options.get('dry_run'))

        now = timezone.now()
        stale_cutoff = now - timedelta(days=stale_days)
        delete_cutoff = now - timedelta(days=delete_days)

        stale_qs = MobileDevice.objects.filter(
            platform='android',
            is_active=True,
            last_seen_at__lt=stale_cutoff,
        )
        stale_count = stale_qs.count()

        deactivated_count = 0
        if stale_count and not dry_run:
            deactivated_count = stale_qs.update(is_active=False)

        delete_qs = MobileDevice.objects.filter(
            platform='android',
            is_active=False,
            last_seen_at__lt=delete_cutoff,
        )
        delete_count = delete_qs.count()

        deleted_count = 0
        if delete_inactive and delete_count and not dry_run:
            deleted_count, _ = delete_qs.delete()

        report = {
            'dry_run': dry_run,
            'stale_days': stale_days,
            'delete_days': delete_days,
            'delete_inactive': delete_inactive,
            'stale_candidates': stale_count,
            'deactivated': deactivated_count,
            'delete_candidates': delete_count,
            'deleted': deleted_count,
        }

        self.stdout.write(self.style.SUCCESS(str(report)))
