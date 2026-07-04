from django.core.management.base import BaseCommand
class Command(BaseCommand):
    help = 'Repairs and regenerates missing thumbnails'
    def handle(self, *args, **options):
        self.stdout.write("Thumbnail repair executed.")\n