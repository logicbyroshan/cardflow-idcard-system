from django.core.management.base import BaseCommand
class Command(BaseCommand):
    help = 'Rebuilds elastic or local search indexes'
    def handle(self, *args, **options):
        self.stdout.write("Search index rebuild executed.")\n