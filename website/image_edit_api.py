"""
Adarsh Engine Image Edit API
=============================
Handles saving edited images and bulk downloads from the Adarsh Engine
image editor (AdarshEngine JavaScript module).

Endpoints:
  POST /api/image-editor/save/ - Save individual edited image
  POST /api/image-editor/download/ - Download edited images as ZIP
"""
import os
import json
import time
import zipfile
import base64
import logging
from django.conf import settings
from django.http import JsonResponse, FileResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt

logger = logging.getLogger(__name__)

# Directory for persisting edited images
EDIT_FOLDER = os.path.join(settings.MEDIA_ROOT, 'edited_images')


def ensure_edit_folder():
    """Create edit folder if it doesn't exist."""
    os.makedirs(EDIT_FOLDER, exist_ok=True)


@csrf_exempt
@require_POST
def save_edited_image(request):
    """
    Save an edited image to the edit folder.
    
    Expected POST data:
      - edit_id (str): Unique ID for this edit (e.g., "edit_0", "edit_1")
      - image_data (str): Base64-encoded PNG image
      - filters (str): JSON-encoded filter parameters
    
    Returns:
      {
        "success": bool,
        "edit_id": str,
        "filename": str,
        "message": str
      }
    """
    try:
        ensure_edit_folder()
        
        edit_id = request.POST.get('edit_id', '').strip()
        image_data_b64 = request.POST.get('image_data', '').strip()
        filters_json = request.POST.get('filters', '{}')
        
        if not edit_id or not image_data_b64:
            return JsonResponse({
                'success': False,
                'message': 'Missing required fields: edit_id or image_data'
            }, status=400)
        
        # Decode base64 image data
        try:
            # Remove data URI prefix if present
            if ',' in image_data_b64:
                image_data_b64 = image_data_b64.split(',')[1]
            image_bytes = base64.b64decode(image_data_b64)
        except Exception as e:
            logger.error(f'Base64 decode failed for {edit_id}: {str(e)}')
            return JsonResponse({
                'success': False,
                'message': 'Invalid base64 image data'
            }, status=400)
        
        # Save edited image with timestamp
        timestamp = int(time.time() * 1000)  # millisecond precision
        filename = f'{edit_id}_{timestamp}.png'
        filepath = os.path.join(EDIT_FOLDER, filename)
        
        with open(filepath, 'wb') as f:
            f.write(image_bytes)
        
        # Save metadata for later reference
        metadata = {
            'edit_id': edit_id,
            'timestamp': timestamp,
            'filters': filters_json,
            'filename': filename,
            'size_bytes': len(image_bytes)
        }
        
        metadata_filename = f'{edit_id}_{timestamp}_meta.json'
        metadata_filepath = os.path.join(EDIT_FOLDER, metadata_filename)
        
        with open(metadata_filepath, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        logger.info(f'Edited image saved: {filename} ({len(image_bytes)} bytes)')
        
        return JsonResponse({
            'success': True,
            'edit_id': edit_id,
            'filename': filename,
            'message': f'Image saved successfully ({len(image_bytes) / 1024:.1f} KB)'
        })
        
    except Exception as e:
        logger.exception(f'save_edited_image error: {str(e)}')
        return JsonResponse({
            'success': False,
            'message': f'Server error: {str(e)}'
        }, status=500)


@csrf_exempt
@require_POST
def download_edited_images(request):
    """
    Download selected edited images as a ZIP file.
    
    Expected POST data:
      - edit_ids (list): List of edit IDs to include (e.g., "edit_0", "edit_1")
    
    Returns:
      ZIP file with all saved edited images
    """
    try:
        ensure_edit_folder()
        
        # Get list of edit IDs from POST data
        edit_ids = request.POST.getlist('edit_ids', [])
        
        if not edit_ids:
            return JsonResponse({
                'success': False,
                'message': 'No images selected for download'
            }, status=400)
        
        # Check if any edited images exist
        if not os.path.exists(EDIT_FOLDER):
            return JsonResponse({
                'success': False,
                'message': 'No edited images available'
            }, status=404)
        
        # Create ZIP file
        zip_filename = f'edited_images_{int(time.time())}.zip'
        zip_filepath = os.path.join(settings.MEDIA_ROOT, zip_filename)
        
        added_files = 0
        with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for edit_id in edit_ids:
                # Find all matching image files for this edit_id
                for filename in os.listdir(EDIT_FOLDER):
                    if filename.startswith(edit_id) and filename.endswith('.png'):
                        file_path = os.path.join(EDIT_FOLDER, filename)
                        # Add to ZIP with just the filename (not full path)
                        zipf.write(file_path, arcname=filename)
                        added_files += 1
        
        if added_files == 0:
            os.remove(zip_filepath)
            return JsonResponse({
                'success': False,
                'message': 'No images found for selected IDs'
            }, status=404)
        
        logger.info(f'ZIP created: {zip_filename} with {added_files} images')
        
        # Stream the ZIP file for download
        response = FileResponse(
            open(zip_filepath, 'rb'),
            content_type='application/zip',
            as_attachment=True,
            filename=zip_filename
        )
        
        # Schedule cleanup of ZIP file after download (optional)
        # In production, you might want to use a celery task or temp cleanup scheduler
        
        return response
        
    except Exception as e:
        logger.exception(f'download_edited_images error: {str(e)}')
        return JsonResponse({
            'success': False,
            'message': f'Download failed: {str(e)}'
        }, status=500)


@csrf_exempt
@require_POST
def cleanup_edited_images(request):
    """
    Admin endpoint to cleanup old edited images (optional).
    
    Expected POST data:
      - days_old (int): Delete images older than this many days (default: 7)
    
    Returns:
      { "success": bool, "deleted": int, "message": str }
    """
    try:
        ensure_edit_folder()
        
        days_old = int(request.POST.get('days_old', 7))
        if days_old < 1:
            days_old = 7
        
        cutoff_time = time.time() - (days_old * 86400)
        deleted_count = 0
        
        for filename in os.listdir(EDIT_FOLDER):
            file_path = os.path.join(EDIT_FOLDER, filename)
            if os.path.isfile(file_path):
                file_mtime = os.path.getmtime(file_path)
                if file_mtime < cutoff_time:
                    os.remove(file_path)
                    deleted_count += 1
        
        logger.info(f'Cleanup: removed {deleted_count} old edited images')
        
        return JsonResponse({
            'success': True,
            'deleted': deleted_count,
            'message': f'Deleted {deleted_count} images older than {days_old} days'
        })
        
    except Exception as e:
        logger.exception(f'cleanup_edited_images error: {str(e)}')
        return JsonResponse({
            'success': False,
            'message': f'Cleanup failed: {str(e)}'
        }, status=500)
