from __future__ import annotations

from django.contrib.auth.decorators import login_required
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_http_methods

from accounts.rate_limit import rate_limit
from core.services.permission_service import api_require_any_admin, require_any_admin
from core.services.realtime_service import publish_topic_event

from .models import OfficeWorkSharedFile
from .upload_security import is_blocked_upload_name, safe_download_filename
from .views_common import (
    MAX_FILE_UPLOAD_BYTES,
    MAX_SHARE_NOTE_LENGTH,
    OFFICEWORK_SHARE_TOPIC,
    serialize_shared_file,
)


@require_http_methods(['GET'])
@rate_limit(max_requests=180, window_seconds=60, key_prefix='ow_share_list')
@api_require_any_admin
def api_office_work_share_list(request):
    shared_files = OfficeWorkSharedFile.objects.select_related('uploaded_by').all()[:300]
    return JsonResponse({
        'success': True,
        'files': [serialize_shared_file(item) for item in shared_files],
    })


@require_http_methods(['POST'])
@rate_limit(max_requests=20, window_seconds=60, key_prefix='ow_share_upload')
@api_require_any_admin
def api_office_work_share_upload(request):
    upload = request.FILES.get('file')
    if upload is None:
        return JsonResponse({'success': False, 'message': 'Please choose a file.'}, status=400)

    size_bytes = int(getattr(upload, 'size', 0) or 0)
    if size_bytes <= 0:
        return JsonResponse({'success': False, 'message': 'File is empty.'}, status=400)

    if size_bytes > MAX_FILE_UPLOAD_BYTES:
        return JsonResponse({'success': False, 'message': 'File is too large (max 50 MB).'}, status=400)

    if is_blocked_upload_name(getattr(upload, 'name', '')):
        return JsonResponse({'success': False, 'message': 'This file type is not allowed for security reasons.'}, status=400)

    title = str(request.POST.get('title') or '').strip()
    note = str(request.POST.get('note') or '').strip()

    shared_file = OfficeWorkSharedFile.objects.create(
        uploaded_by=request.user,
        title=title[:200],
        note=note[:MAX_SHARE_NOTE_LENGTH],
        original_name=(getattr(upload, 'name', '') or '')[:255],
        file=upload,
        size_bytes=size_bytes,
    )
    shared_file = OfficeWorkSharedFile.objects.select_related('uploaded_by').get(pk=shared_file.pk)
    file_payload = serialize_shared_file(shared_file)

    publish_topic_event(
        topic=OFFICEWORK_SHARE_TOPIC,
        event_type='officework.share.uploaded',
        payload={
            'file': file_payload,
            'file_id': shared_file.id,
            'actor_id': request.user.id,
        },
    )

    return JsonResponse({
        'success': True,
        'message': 'File shared successfully.',
        'file': file_payload,
    })


@login_required
@require_any_admin
@require_http_methods(['GET'])
def api_office_work_share_download(request, file_id):
    shared_file = get_object_or_404(OfficeWorkSharedFile, pk=file_id)
    if not shared_file.file:
        raise Http404('File not found.')

    try:
        file_handle = shared_file.file.open('rb')
    except FileNotFoundError:
        raise Http404('File missing from storage.')

    download_name = safe_download_filename(
        shared_file.original_name or shared_file.file.name.rsplit('/', 1)[-1],
        fallback=f'office-file-{shared_file.id}',
    )
    return FileResponse(file_handle, as_attachment=True, filename=download_name)


@require_http_methods(['POST'])
@rate_limit(max_requests=30, window_seconds=60, key_prefix='ow_share_delete')
@api_require_any_admin
def api_office_work_share_delete(request, file_id):
    shared_file = get_object_or_404(OfficeWorkSharedFile, pk=file_id)
    deleted_file_id = int(shared_file.id)
    if shared_file.file:
        shared_file.file.delete(save=False)
    shared_file.delete()

    publish_topic_event(
        topic=OFFICEWORK_SHARE_TOPIC,
        event_type='officework.share.deleted',
        payload={
            'file_id': deleted_file_id,
            'actor_id': request.user.id,
        },
    )

    return JsonResponse({'success': True, 'message': 'Shared file deleted.'})
