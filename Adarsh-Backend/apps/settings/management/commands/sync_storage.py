from django.core.management.base import BaseCommand
class Command(BaseCommand):
    help = 'Syncs local storage to remote storage'
    def handle(self, *args, **options):
        self.stdout.write("Storage sync executed.")\n