import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
from typing import Dict

from django.conf import settings
from django.core.files.base import ContentFile

logger = logging.getLogger(__name__)
_FFMPEG_EXE_CACHE = None


def _clamp_int(value, default, minimum=None, maximum=None):
    try:
        num = int(value)
    except (TypeError, ValueError):
        num = int(default)
    if minimum is not None:
        num = max(minimum, num)
    if maximum is not None:
        num = min(maximum, num)
    return num


VIDEO_MAX_WIDTH = _clamp_int(getattr(settings, 'WEBSITE_VIDEO_MAX_WIDTH', 1080), 1080, 240, 4096)
VIDEO_MAX_HEIGHT = _clamp_int(getattr(settings, 'WEBSITE_VIDEO_MAX_HEIGHT', 1920), 1920, 240, 4096)
VIDEO_CRF = _clamp_int(getattr(settings, 'WEBSITE_VIDEO_CRF', 24), 24, 23, 28)


def _normalize_media_relpath(path: str) -> str:
    if not path:
        return ''
    parts = []
    for part in str(path).replace('\\', '/').split('/'):
        part = part.strip()
        if not part or part == '.':
            continue
        if part == '..':
            return ''
        parts.append(part)
    return '/'.join(parts)


def _media_abs_path(rel_path: str) -> str:
    normalized = _normalize_media_relpath(rel_path)
    if not normalized:
        return ''
    media_root = os.path.realpath(settings.MEDIA_ROOT)
    abs_path = os.path.realpath(os.path.join(media_root, normalized))
    if abs_path == media_root or abs_path.startswith(media_root + os.sep):
        return abs_path
    return ''


def _media_url(rel_path: str) -> str:
    normalized = _normalize_media_relpath(rel_path)
    if not normalized:
        return ''
    return settings.MEDIA_URL.rstrip('/') + '/' + normalized


def _safe_stem(value: str) -> str:
    stem = re.sub(r'[^a-zA-Z0-9_-]+', '-', value or '').strip('-')
    return stem or 'video'


def _build_even_scale_filter(max_width: int, max_height: int) -> str:
    # H.264 requires even frame dimensions; enforce that after aspect fit.
    return (
        'scale='
        + str(max_width)
        + ':'
        + str(max_height)
        + ':force_original_aspect_ratio=decrease,'
        + 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
    )


def _portfolio_derivative_relpaths(video_rel_path: str):
    normalized = _normalize_media_relpath(video_rel_path)
    base_name = os.path.basename(normalized)
    stem, _ = os.path.splitext(base_name)
    hash_suffix = hashlib.sha1(normalized.encode('utf-8')).hexdigest()[:10]
    token = _safe_stem(stem) + '-' + hash_suffix

    thumbnail_rel = 'images/Products/video-thumbs/' + token + '.jpg'
    stream_dir_rel = 'videos/Portfolio/streams/' + token
    playlist_rel = stream_dir_rel + '/index.m3u8'

    return {
        'thumbnail_rel': thumbnail_rel,
        'stream_dir_rel': stream_dir_rel,
        'playlist_rel': playlist_rel,
    }


def _resolve_ffmpeg_executable() -> str:
    global _FFMPEG_EXE_CACHE
    if _FFMPEG_EXE_CACHE is not None:
        return _FFMPEG_EXE_CACHE

    configured = str(getattr(settings, 'WEBSITE_FFMPEG_BINARY', '') or '').strip()
    if configured and os.path.exists(configured):
        _FFMPEG_EXE_CACHE = configured
        return _FFMPEG_EXE_CACHE

    system_bin = shutil.which('ffmpeg')
    if system_bin:
        _FFMPEG_EXE_CACHE = system_bin
        return _FFMPEG_EXE_CACHE

    try:
        import imageio_ffmpeg

        embedded = imageio_ffmpeg.get_ffmpeg_exe()
        if embedded and os.path.exists(embedded):
            _FFMPEG_EXE_CACHE = embedded
            return _FFMPEG_EXE_CACHE
    except Exception:
        logger.warning('Unable to resolve embedded ffmpeg binary', exc_info=True)

    _FFMPEG_EXE_CACHE = ''
    return _FFMPEG_EXE_CACHE


def is_ffmpeg_available() -> bool:
    ffmpeg_exe = _resolve_ffmpeg_executable()
    if not ffmpeg_exe:
        return False
    try:
        subprocess.run([ffmpeg_exe, '-version'], capture_output=True, timeout=10, check=True)
        return True
    except (FileNotFoundError, OSError, subprocess.SubprocessError):
        return False


def normalize_portfolio_video_upload(file_obj):
    """
    Re-encode uploaded portfolio video to H.264/AAC MP4 and cap resolution.

    - CRF is clamped to 23-28 (default 24)
    - Output frame is bounded to WEBSITE_VIDEO_MAX_WIDTH x WEBSITE_VIDEO_MAX_HEIGHT
    - Returns original file object when ffmpeg is unavailable or re-encode fails
    """
    if not file_obj:
        return file_obj

    original_name = getattr(file_obj, 'name', 'video.mp4') or 'video.mp4'
    ext = os.path.splitext(original_name)[1] or '.mp4'

    try:
        file_obj.seek(0)
        raw = file_obj.read()
    except (AttributeError, OSError):
        return file_obj

    if not raw:
        try:
            file_obj.seek(0)
        except (AttributeError, OSError):
            pass
        return file_obj

    ffmpeg_exe = _resolve_ffmpeg_executable()
    if not ffmpeg_exe:
        logger.info('normalize_portfolio_video_upload: ffmpeg unavailable, keeping original upload')
        try:
            file_obj.seek(0)
        except (AttributeError, OSError):
            pass
        return file_obj

    tmp_in = ''
    tmp_out = ''
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as in_f:
            in_f.write(raw)
            tmp_in = in_f.name

        tmp_out = tmp_in + '_normalized.mp4'

        scale_filter = _build_even_scale_filter(VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT)

        cmd = [
            ffmpeg_exe, '-y',
            '-i', tmp_in,
            '-vf', scale_filter,
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', str(VIDEO_CRF),
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            tmp_out,
        ]

        proc = subprocess.run(cmd, capture_output=True, timeout=1800)
        if proc.returncode != 0 or not os.path.exists(tmp_out):
            logger.warning(
                'normalize_portfolio_video_upload: ffmpeg failed code=%s stderr=%s',
                proc.returncode,
                (proc.stderr or b'')[-800:].decode('utf-8', errors='ignore'),
            )
            try:
                file_obj.seek(0)
            except (AttributeError, OSError):
                pass
            return file_obj

        with open(tmp_out, 'rb') as out_f:
            out_bytes = out_f.read()

        if not out_bytes:
            try:
                file_obj.seek(0)
            except (AttributeError, OSError):
                pass
            return file_obj

        base_name = os.path.splitext(original_name)[0]
        normalized = ContentFile(out_bytes, name=base_name + '.mp4')
        setattr(normalized, '_portfolio_video_processed', True)
        return normalized

    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        logger.warning('normalize_portfolio_video_upload failed', exc_info=True)
        try:
            file_obj.seek(0)
        except (AttributeError, OSError):
            pass
        return file_obj
    finally:
        for candidate in (tmp_in, tmp_out):
            if candidate:
                try:
                    os.unlink(candidate)
                except OSError:
                    pass


def ensure_portfolio_video_derivatives(video_rel_path: str, force: bool = False) -> Dict[str, str]:
    """
    Build sidecar assets for a saved portfolio video file:
    - JPEG thumbnail (for card/grid placeholders)
    - HLS playlist + segments (for streaming playback)

    Returns currently available URLs (stream + thumbnail + fallback mp4).
    """
    normalized = _normalize_media_relpath(video_rel_path)
    input_abs = _media_abs_path(normalized)
    if not normalized or not input_abs or not os.path.exists(input_abs):
        return get_portfolio_video_asset_urls(video_rel_path)

    if not is_ffmpeg_available():
        return get_portfolio_video_asset_urls(video_rel_path)

    ffmpeg_exe = _resolve_ffmpeg_executable()
    if not ffmpeg_exe:
        return get_portfolio_video_asset_urls(video_rel_path)

    rel = _portfolio_derivative_relpaths(normalized)
    thumb_abs = _media_abs_path(rel['thumbnail_rel'])
    stream_dir_abs = _media_abs_path(rel['stream_dir_rel'])
    playlist_abs = _media_abs_path(rel['playlist_rel'])

    if not thumb_abs or not stream_dir_abs or not playlist_abs:
        return get_portfolio_video_asset_urls(video_rel_path)

    try:
        os.makedirs(os.path.dirname(thumb_abs), exist_ok=True)

        if force and os.path.exists(thumb_abs):
            try:
                os.unlink(thumb_abs)
            except OSError:
                pass

        if force and os.path.isdir(stream_dir_abs):
            shutil.rmtree(stream_dir_abs, ignore_errors=True)

        if force or not os.path.exists(thumb_abs):
            thumb_cmd = [
                ffmpeg_exe, '-y',
                '-ss', '00:00:01.000',
                '-i', input_abs,
                '-frames:v', '1',
                '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease',
                '-q:v', '3',
                thumb_abs,
            ]
            thumb_proc = subprocess.run(thumb_cmd, capture_output=True, timeout=300)
            if thumb_proc.returncode != 0 or not os.path.exists(thumb_abs):
                # Retry first frame as fallback for very short clips.
                thumb_retry = [
                    ffmpeg_exe, '-y',
                    '-ss', '00:00:00.000',
                    '-i', input_abs,
                    '-frames:v', '1',
                    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease',
                    '-q:v', '3',
                    thumb_abs,
                ]
                subprocess.run(thumb_retry, capture_output=True, timeout=300)

        if force or not os.path.exists(playlist_abs):
            os.makedirs(stream_dir_abs, exist_ok=True)
            segment_pattern = os.path.join(stream_dir_abs, 'seg_%03d.ts')
            hls_cmd = [
                ffmpeg_exe, '-y',
                '-i', input_abs,
                '-vf', (
                    _build_even_scale_filter(VIDEO_MAX_WIDTH, VIDEO_MAX_HEIGHT)
                ),
                '-c:v', 'libx264',
                '-preset', 'veryfast',
                '-crf', str(VIDEO_CRF),
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-ac', '2',
                '-ar', '48000',
                '-g', '48',
                '-keyint_min', '48',
                '-sc_threshold', '0',
                '-hls_time', '6',
                '-hls_playlist_type', 'vod',
                '-hls_segment_filename', segment_pattern,
                playlist_abs,
            ]
            hls_proc = subprocess.run(hls_cmd, capture_output=True, timeout=1800)
            if hls_proc.returncode != 0:
                logger.warning(
                    'ensure_portfolio_video_derivatives: HLS generation failed code=%s stderr=%s',
                    hls_proc.returncode,
                    (hls_proc.stderr or b'')[-800:].decode('utf-8', errors='ignore'),
                )

    except (OSError, subprocess.SubprocessError, ValueError):
        logger.warning('ensure_portfolio_video_derivatives failed', exc_info=True)

    return get_portfolio_video_asset_urls(video_rel_path)


def get_portfolio_video_asset_urls(video_rel_path: str) -> Dict[str, str]:
    normalized = _normalize_media_relpath(video_rel_path)
    if not normalized:
        return {
            'video_file_url': '',
            'stream_url': '',
            'stream_fallback_url': '',
            'thumbnail_url': '',
        }

    rel = _portfolio_derivative_relpaths(normalized)

    playlist_abs = _media_abs_path(rel['playlist_rel'])
    thumbnail_abs = _media_abs_path(rel['thumbnail_rel'])

    stream_url = _media_url(rel['playlist_rel']) if playlist_abs and os.path.exists(playlist_abs) else ''
    thumb_url = _media_url(rel['thumbnail_rel']) if thumbnail_abs and os.path.exists(thumbnail_abs) else ''
    video_url = _media_url(normalized)

    return {
        'video_file_url': video_url,
        'stream_url': stream_url,
        'stream_fallback_url': video_url,
        'thumbnail_url': thumb_url,
    }


def get_portfolio_video_thumbnail_url(video_rel_path: str) -> str:
    return get_portfolio_video_asset_urls(video_rel_path).get('thumbnail_url', '')


def get_portfolio_video_stream_url(video_rel_path: str) -> str:
    return get_portfolio_video_asset_urls(video_rel_path).get('stream_url', '')


def purge_portfolio_video_derivatives(video_rel_path: str) -> None:
    normalized = _normalize_media_relpath(video_rel_path)
    if not normalized:
        return

    rel = _portfolio_derivative_relpaths(normalized)
    thumb_abs = _media_abs_path(rel['thumbnail_rel'])
    stream_dir_abs = _media_abs_path(rel['stream_dir_rel'])

    if thumb_abs and os.path.exists(thumb_abs):
        try:
            os.unlink(thumb_abs)
        except OSError:
            pass

    if stream_dir_abs and os.path.isdir(stream_dir_abs):
        shutil.rmtree(stream_dir_abs, ignore_errors=True)


def process_portfolio_video_file(video_rel_path: str, max_bytes: int = 10 * 1024 * 1024) -> None:
    """
    Background-friendly entry point to normalize/compress a saved portfolio video
    file and generate its derivatives (thumbnail + HLS segments).

    This function is safe to call from a background thread/process — it works
    with on-disk files under MEDIA_ROOT and does not rely on request state.
    """
    try:
        # Lazy imports to avoid pulling heavy libs into request cycle
        from django.core.files.base import ContentFile
        from .watermark import compress_video_file
        # Read input file from MEDIA_ROOT
        normalized = _normalize_media_relpath(video_rel_path)
        if not normalized:
            return
        input_abs = _media_abs_path(normalized)
        if not input_abs or not os.path.exists(input_abs):
            return

        # Read bytes from disk
        try:
            with open(input_abs, 'rb') as f:
                original_bytes = f.read()
        except Exception:
            return

        # Wrap as ContentFile for existing helpers
        content = ContentFile(original_bytes, name=os.path.basename(normalized))

        # Normalize (re-encode) if ffmpeg is available
        try:
            processed = normalize_portfolio_video_upload(content)
        except Exception:
            processed = content

        # Compress to target size
        try:
            compressed = compress_video_file(processed, max_bytes=max_bytes)
        except Exception:
            compressed = processed

        # If compressed differs from original, atomically replace on-disk file
        try:
            # Write to temp file then rename
            with tempfile.NamedTemporaryFile(delete=False, dir=os.path.dirname(input_abs)) as tmpf:
                tmpf.write(compressed.read() if hasattr(compressed, 'read') else compressed)
                tmp_path = tmpf.name
            os.replace(tmp_path, input_abs)
        except Exception:
            # Best-effort: leave original file intact
            try:
                if 'tmp_path' in locals() and os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            except Exception:
                pass

        # Ensure derivatives (thumbnail + HLS)
        try:
            ensure_portfolio_video_derivatives(normalized, force=False)
        except Exception:
            logger.exception('process_portfolio_video_file: derivatives generation failed for %s', normalized)

    except Exception:
        logger.exception('process_portfolio_video_file failed for %s', video_rel_path)
