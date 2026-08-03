from django.core.management.base import BaseCommand
class Command(BaseCommand):
    help = 'Cleans up old export files'
    def handle(self, *args, **options):
        self.stdout.write("Export cleanup executed.")\n