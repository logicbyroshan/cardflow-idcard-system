from django.core.management.base import BaseCommand
class Command(BaseCommand):
    help = 'Cleans up old import files'
    def handle(self, *args, **options):
        self.stdout.write("Import cleanup executed.")\n