import os
import traceback
import time
from celery import shared_task
from django.conf import settings
from apps.cards.models import Card
from apps.fields.models import Field
from apps.users.models import User
from apps.jobs.models import Job, JobStatus, JobType
from apps.jobs.services import JobService
from apps.mediafiles.services import MediaService

@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=5,
    time_limit=300,
    soft_time_limit=280
)
def run_job_task(self, job_id: str):
    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return f"Job {job_id} not found."

    if job.status == JobStatus.CANCELLED:
        return f"Job {job_id} was cancelled before starting."

    # Start the job
    JobService.start_job(job)

    try:
        user = job.created_by
        
        if job.type in [JobType.IMAGE_UPLOAD, JobType.IMAGE_REPLACE]:
            # 1. Extract parameters
            temp_file_path = job.payload.get('temp_file_path')
            original_name = job.payload.get('original_name')
            mime_type = job.payload.get('mime_type')
            card_id = job.payload.get('card_id')
            field_id = job.payload.get('field_id')
            
            JobService.update_progress(job, 10, "Parameters extracted")
            
            if not temp_file_path or not os.path.exists(temp_file_path):
                raise FileNotFoundError(f"Temporary upload file not found: {temp_file_path}")
                
            card = Card.objects.get(id=card_id)
            field = Field.objects.get(id=field_id)
            
            JobService.update_progress(job, 30, "Card and field retrieved")
            
            # 2. Open file and upload
            with open(temp_file_path, 'rb') as f:
                JobService.update_progress(job, 50, "Processing image")
                
                media_file = MediaService.upload_image(
                    card=card,
                    field=field,
                    file_name=original_name,
                    content_type=mime_type,
                    file_content=f,
                    user=user
                )
                
            JobService.update_progress(job, 80, "Image uploaded and database updated")
            
            # 3. Clean up temporary file
            try:
                os.remove(temp_file_path)
            except Exception:
                pass
                
            JobService.complete_job(job, {"media_file_id": str(media_file.id)})
            
        elif job.type == JobType.IMAGE_DELETE:
            card_id = job.payload.get('card_id')
            field_id = job.payload.get('field_id')
            
            card = Card.objects.get(id=card_id)
            field = Field.objects.get(id=field_id)
            
            JobService.update_progress(job, 50, "Deleting media reference")
            MediaService.delete_image(card, field, user)
            
            JobService.complete_job(job)
            
        elif job.type in [JobType.IMPORT_XLSX, JobType.IMPORT_XLSX_ZIP]:
            excel_path = job.payload.get('excel_path')
            zip_path = job.payload.get('zip_path')
            import_session_id = job.payload.get('import_session_id')
            
            from apps.imports.models import ImportSession
            from apps.imports.services import ImportService
            
            import_session = ImportSession.objects.get(id=import_session_id)
            
            def progress_callback(pct, step):
                JobService.update_progress(job, pct, step)
                
            ImportService.process_xlsx_import(
                import_session=import_session,
                excel_path=excel_path,
                zip_path=zip_path,
                job=job,
                progress_callback=progress_callback
            )
            
            # Clean up files
            for p in [excel_path, zip_path]:
                if p and os.path.exists(p):
                    try:
                        os.remove(p)
                    except Exception:
                        pass
                        
            JobService.complete_job(job, {"import_session_id": str(import_session.id)})
            
        elif job.type == JobType.REUPLOAD_IMAGES:
            zip_path = job.payload.get('zip_path')
            reupload_session_id = job.payload.get('reupload_session_id')
            
            from apps.imports.models import ReuploadSession
            from apps.imports.services import ImportService
            
            reupload_session = ReuploadSession.objects.get(id=reupload_session_id)
            
            def progress_callback(pct, step):
                JobService.update_progress(job, pct, step)
                
            ImportService.process_image_reupload(
                reupload_session=reupload_session,
                zip_path=zip_path,
                progress_callback=progress_callback
            )
            
            if zip_path and os.path.exists(zip_path):
                try:
                    os.remove(zip_path)
                except Exception:
                    pass
                    
            JobService.complete_job(job, {"reupload_session_id": str(reupload_session.id)})
            
        elif job.type in [JobType.EXPORT_PDF, JobType.EXPORT_DOCX, JobType.EXPORT_XLSX, JobType.EXPORT_ZIP]:
            export_session_id = job.payload.get('export_session_id')

            from apps.exports.models import ExportSession
            from apps.exports.services import ExportService

            export_session = ExportSession.objects.get(id=export_session_id)

            def progress_callback(pct, step):
                JobService.update_progress(job, pct, step)

            ExportService.process_export(
                export_session=export_session,
                job=job,
                progress_callback=progress_callback,
            )

            JobService.complete_job(job, {'export_session_id': str(export_session.id)})

            
    except Exception as exc:
        tb_str = traceback.format_exc()
        if self.request.retries < self.max_retries:
            JobService.log_message(job, f"Retrying task due to error: {str(exc)}", 'WARNING')
            countdown = self.default_retry_delay * (self.request.retries + 1)
            self.retry(exc=exc, countdown=countdown)
        else:
            # Cleanup for failed jobs
            for key in ['excel_path', 'zip_path', 'temp_file_path']:
                path = job.payload.get(key)
                if path and os.path.exists(path):
                    try:
                        os.remove(path)
                    except Exception:
                        pass
            JobService.fail_job(job, tb_str)
            raise exc
            
    return f"Job {job_id} processed successfully."
