from django.core.management.base import BaseCommand

from website.models import PortfolioItem
from website.video_processing import (
    ensure_portfolio_video_derivatives,
    get_portfolio_video_asset_urls,
    is_ffmpeg_available,
)


class Command(BaseCommand):
    help = (
        'Generate/refresh portfolio video derivative assets (thumbnail + HLS stream playlist) '
        'for uploaded video files.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit',
            type=int,
            default=0,
            help='Process at most N portfolio videos (0 = all).',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Rebuild derivatives even when files already exist.',
        )

    def handle(self, *args, **options):
        if not is_ffmpeg_available():
            self.stderr.write(self.style.ERROR('FFmpeg/ffprobe is not available on PATH.'))
            return

        qs = PortfolioItem.objects.filter(video_file__isnull=False).exclude(video_file='').order_by('id')
        limit = max(0, int(options.get('limit') or 0))
        if limit:
            qs = qs[:limit]

        total = qs.count() if hasattr(qs, 'count') else len(qs)
        if total == 0:
            self.stdout.write(self.style.WARNING('No portfolio videos found to process.'))
            return

        created_or_refreshed = 0
        skipped = 0

        for item in qs:
            video_name = item.video_file.name
            before = get_portfolio_video_asset_urls(video_name)
            ensure_portfolio_video_derivatives(video_name, force=bool(options.get('force')))
            after = get_portfolio_video_asset_urls(video_name)

            changed = (
                before.get('thumbnail_url') != after.get('thumbnail_url')
                or before.get('stream_url') != after.get('stream_url')
                or bool(options.get('force'))
            )
            if changed:
                created_or_refreshed += 1
                self.stdout.write(f'Processed item #{item.id}: {item.title}')
            else:
                skipped += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'Done. Processed={created_or_refreshed}, Skipped={skipped}, Total={total}'
            )
        )
