import os
import uuid
from django.conf import settings
from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import ValidationError
from apps.cards.selectors import CardSelector
from apps.fields.models import Field
from apps.mediafiles.models import MediaFile
from apps.mediafiles.serializers import MediaFileSerializer
from apps.mediafiles.services import MediaService
from apps.jobs.models import JobType
from apps.jobs.services import JobService
from apps.jobs.tasks import run_job_task
from apps.jobs.serializers import JobSerializer

class MediaViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = MediaFile.objects.filter(is_deleted=False)
    serializer_class = MediaFileSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['post'], url_path='upload')
    def upload(self, request):
        card_id = request.data.get('card_id')
        field_id = request.data.get('field_id')
        uploaded_file = request.FILES.get('file')
        
        if not card_id or not field_id or not uploaded_file:
            raise ValidationError("card_id, field_id, and file are required.")
            
        card = CardSelector.get_card(card_id)
        if not card:
            return Response({'error': 'Card not found.'}, status=status.HTTP_404_NOT_FOUND)
            
        try:
            field = Field.objects.get(id=field_id)
        except Field.DoesNotExist:
            return Response({'error': 'Field not found.'}, status=status.HTTP_404_NOT_FOUND)
            
        # Save uploaded file to temporary path for Celery to pick up
        temp_dir = os.path.join(settings.BASE_DIR, 'media', 'temp_uploads')
        os.makedirs(temp_dir, exist_ok=True)
        temp_filepath = os.path.join(temp_dir, f"{uuid.uuid4()}.tmp")
        
        with open(temp_filepath, 'wb') as f:
            for chunk in uploaded_file.chunks():
                f.write(chunk)
                
        # Create Job
        payload = {
            'temp_file_path': temp_filepath,
            'original_name': uploaded_file.name,
            'mime_type': uploaded_file.content_type,
            'card_id': str(card.id),
            'field_id': str(field.id)
        }
        
        job = JobService.create_job(JobType.IMAGE_UPLOAD, payload, request.user)
        
        # Dispatch Celery task
        # We can route this to the 'images' queue dynamically
        async_res = run_job_task.apply_async(args=[str(job.id)], queue='images')
        job.celery_task_id = async_res.id
        job.save(update_fields=['celery_task_id'])
        
        return Response(JobSerializer(job).data, status=status.HTTP_202_ACCEPTED)

    @action(detail=False, methods=['post'], url_path='replace')
    def replace(self, request):
        card_id = request.data.get('card_id')
        field_id = request.data.get('field_id')
        uploaded_file = request.FILES.get('file')
        
        if not card_id or not field_id or not uploaded_file:
            raise ValidationError("card_id, field_id, and file are required.")
            
        card = CardSelector.get_card(card_id)
        if not card:
            return Response({'error': 'Card not found.'}, status=status.HTTP_404_NOT_FOUND)
            
        try:
            field = Field.objects.get(id=field_id)
        except Field.DoesNotExist:
            return Response({'error': 'Field not found.'}, status=status.HTTP_404_NOT_FOUND)
            
        # Save uploaded file to temporary path
        temp_dir = os.path.join(settings.BASE_DIR, 'media', 'temp_uploads')
        os.makedirs(temp_dir, exist_ok=True)
        temp_filepath = os.path.join(temp_dir, f"{uuid.uuid4()}.tmp")
        
        with open(temp_filepath, 'wb') as f:
            for chunk in uploaded_file.chunks():
                f.write(chunk)
                
        # Create Job
        payload = {
            'temp_file_path': temp_filepath,
            'original_name': uploaded_file.name,
            'mime_type': uploaded_file.content_type,
            'card_id': str(card.id),
            'field_id': str(field.id)
        }
        
        job = JobService.create_job(JobType.IMAGE_REPLACE, payload, request.user)
        
        # Dispatch Celery task to 'images' queue
        async_res = run_job_task.apply_async(args=[str(job.id)], queue='images')
        job.celery_task_id = async_res.id
        job.save(update_fields=['celery_task_id'])
        
        return Response(JobSerializer(job).data, status=status.HTTP_202_ACCEPTED)

    @action(detail=False, methods=['post'], url_path='delete')
    def delete_image(self, request):
        card_id = request.data.get('card_id')
        field_id = request.data.get('field_id')
        
        if not card_id or not field_id:
            raise ValidationError("card_id and field_id are required.")
            
        card = CardSelector.get_card(card_id)
        if not card:
            return Response({'error': 'Card not found.'}, status=status.HTTP_404_NOT_FOUND)
            
        try:
            field = Field.objects.get(id=field_id)
        except Field.DoesNotExist:
            return Response({'error': 'Field not found.'}, status=status.HTTP_404_NOT_FOUND)
            
        payload = {
            'card_id': str(card.id),
            'field_id': str(field.id)
        }
        
        job = JobService.create_job(JobType.IMAGE_DELETE, payload, request.user)
        
        # Dispatch Celery task to 'images' queue
        async_res = run_job_task.apply_async(args=[str(job.id)], queue='images')
        job.celery_task_id = async_res.id
        job.save(update_fields=['celery_task_id'])
        
        return Response(JobSerializer(job).data, status=status.HTTP_202_ACCEPTED)

    @action(detail=False, methods=['post'], url_path='restore')
    def restore(self, request):
        media_file_id = request.data.get('media_file_id')
        if not media_file_id:
            raise ValidationError("media_file_id is required.")
            
        restored_media = MediaService.restore_image(media_file_id, request.user)
        return Response(MediaFileSerializer(restored_media).data)
