from django.core.management.base import BaseCommand
from website.email_utils import process_pending_emails


class Command(BaseCommand):
    help = 'Process pending contact form emails and retry failed ones'

    def handle(self, *args, **options):
        self.stdout.write('Processing pending contact emails...')
        process_pending_emails()
        self.stdout.write(self.style.SUCCESS('Done processing emails'))
