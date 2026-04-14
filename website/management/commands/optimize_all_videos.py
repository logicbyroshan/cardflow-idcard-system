import os
import subprocess
import tempfile

from django.conf import settings
from django.core.management.base import BaseCommand

from website.models import PortfolioItem, Reel
from website.video_processing import (
    VIDEO_CRF,
    VIDEO_MAX_HEIGHT,
    VIDEO_MAX_WIDTH,
    _build_even_scale_filter,
    _resolve_ffmpeg_executable,
    ensure_portfolio_video_derivatives,
)


VIDEO_EXTENSIONS = {
    '.mp4', '.mov', '.m4v', '.avi', '.mkv', '.wmv', '.webm', '.mpeg', '.mpg',
}
CONTAINER_FASTSTART_EXTENSIONS = {'.mp4', '.mov', '.m4v'}


def _normalize_rel_path(path_value):
    return str(path_value or '').replace('\\', '/').strip().lstrip('/')


def _scan_video_paths(media_root):
    media_root_real = os.path.realpath(media_root)
    found = []
    for root, dirs, files in os.walk(media_root_real):
        root_norm = root.replace('\\', '/').lower()
        if '/videos/portfolio/streams' in root_norm:
            continue

        for name in files:
            ext = os.path.splitext(name)[1].lower()
            if ext not in VIDEO_EXTENSIONS:
                continue
            abs_path = os.path.realpath(os.path.join(root, name))
            if not abs_path.startswith(media_root_real + os.sep) and abs_path != media_root_real:
                continue
            rel_path = _normalize_rel_path(os.path.relpath(abs_path, media_root_real))
            found.append((abs_path, rel_path))
    return sorted(found, key=lambda row: row[1].lower())


def _transcode_in_place(abs_path, ffmpeg_exe):
    src_ext = os.path.splitext(abs_path)[1].lower() or '.mp4'
    tmp_fd = None
    tmp_out = ''

    try:
        tmp_fd, tmp_out = tempfile.mkstemp(
            prefix='opt-vid-',
            suffix=src_ext,
            dir=os.path.dirname(abs_path) or None,
        )
        os.close(tmp_fd)
        tmp_fd = None

        cmd = [
            ffmpeg_exe,
            '-y',
            '-i',
            abs_path,
            '-vf',
            _build_even_scale_filter(VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT),
            '-c:v',
            'libx264',
            '-preset',
            'medium',
            '-crf',
            str(VIDEO_CRF),
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
        ]
        if src_ext in CONTAINER_FASTSTART_EXTENSIONS:
            cmd.extend(['-movflags', '+faststart'])

        cmd.append(tmp_out)

        proc = subprocess.run(cmd, capture_output=True, timeout=3600)
        if proc.returncode != 0:
            stderr = (proc.stderr or b'')[-500:].decode('utf-8', errors='ignore')
            return False, f'ffmpeg_failed: {stderr}'

        if not os.path.exists(tmp_out) or os.path.getsize(tmp_out) <= 0:
            return False, 'empty_output'

        os.replace(tmp_out, abs_path)
        tmp_out = ''
        return True, 'ok'
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        return False, f'exception: {exc}'
    finally:
        if tmp_fd is not None:
            try:
                os.close(tmp_fd)
            except OSError:
                pass
        if tmp_out and os.path.exists(tmp_out):
            try:
                os.unlink(tmp_out)
            except OSError:
                pass


class Command(BaseCommand):
    help = (
        'Compress all media videos in-place using H.264/AAC with max resolution '
        f'{VIDEO_MAX_WIDTH}x{VIDEO_MAX_HEIGHT}. '
        'Portfolio videos also rebuild thumbnail/HLS derivatives.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--limit',
            type=int,
            default=0,
            help='Process at most N videos (0 = all found videos).',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='List candidate videos without writing changes.',
        )
        parser.add_argument(
            '--media-root',
            default='',
            help='Optional media root override. Defaults to settings.MEDIA_ROOT.',
        )
        parser.add_argument(
            '--skip-portfolio-derivatives',
            action='store_true',
            help='Do not rebuild portfolio HLS/thumbnail derivatives after re-encode.',
        )

    def handle(self, *args, **options):
        ffmpeg_exe = _resolve_ffmpeg_executable()
        if not ffmpeg_exe or not os.path.exists(ffmpeg_exe):
            self.stderr.write(self.style.ERROR('FFmpeg binary not found. Configure WEBSITE_FFMPEG_BINARY or install ffmpeg.'))
            return

        media_root = options.get('media_root') or settings.MEDIA_ROOT
        media_root = os.path.realpath(media_root)
        if not os.path.isdir(media_root):
            self.stderr.write(self.style.ERROR(f'Media root not found: {media_root}'))
            return

        portfolio_video_relpaths = {
            _normalize_rel_path(path)
            for path in PortfolioItem.objects.filter(video_file__isnull=False).exclude(video_file='').values_list('video_file', flat=True)
            if path
        }
        reel_video_relpaths = {
            _normalize_rel_path(path)
            for path in Reel.objects.filter(video_file__isnull=False).exclude(video_file='').values_list('video_file', flat=True)
            if path
        }

        candidates = _scan_video_paths(media_root)
        limit = max(0, int(options.get('limit') or 0))
        if limit:
            candidates = candidates[:limit]

        total = len(candidates)
        if total == 0:
            self.stdout.write(self.style.WARNING('No video files found in MEDIA_ROOT.'))
            return

        dry_run = bool(options.get('dry_run'))
        skip_derivatives = bool(options.get('skip_portfolio_derivatives'))

        self.stdout.write(
            self.style.NOTICE(
                f'Starting video optimization: total={total}, dry_run={dry_run}, media_root={media_root}'
            )
        )

        processed = 0
        failed = 0
        portfolio_derivatives_rebuilt = 0

        for index, (abs_path, rel_path) in enumerate(candidates, start=1):
            is_portfolio = rel_path in portfolio_video_relpaths
            is_reel = rel_path in reel_video_relpaths
            scope_label = 'portfolio' if is_portfolio else ('reel' if is_reel else 'file')

            if dry_run:
                self.stdout.write(f'[{index}/{total}] would_process ({scope_label}): {rel_path}')
                continue

            ok, detail = _transcode_in_place(abs_path, ffmpeg_exe)
            if not ok:
                failed += 1
                self.stderr.write(self.style.WARNING(f'[{index}/{total}] failed: {rel_path} ({detail})'))
                continue

            processed += 1
            self.stdout.write(f'[{index}/{total}] optimized ({scope_label}): {rel_path}')

            if is_portfolio and not skip_derivatives:
                ensure_portfolio_video_derivatives(rel_path, force=True)
                portfolio_derivatives_rebuilt += 1

        if dry_run:
            self.stdout.write(self.style.SUCCESS(f'Dry run complete. Candidates={total}'))
            return

        self.stdout.write(
            self.style.SUCCESS(
                'Done. '
                f'Optimized={processed}, Failed={failed}, Total={total}, '
                f'PortfolioDerivativesRebuilt={portfolio_derivatives_rebuilt}'
            )
        )