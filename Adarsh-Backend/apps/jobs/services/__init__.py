from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from apps.auditlogs.models import AuditLog
from apps.jobs.models import Job, JobStatus, JobLog, JobEvent

class JobService:
    @staticmethod
    @transaction.atomic
    def create_job(job_type: str, payload: dict, user=None) -> Job:
        job = Job.objects.create(
            type=job_type,
            payload=payload,
            status=JobStatus.QUEUED,
            created_by=user
        )
        
        JobEvent.objects.create(
            job=job,
            event_type='QUEUED',
            details={}
        )
        
        JobService.log_message(job, f"Job queued of type {job_type}.", 'INFO')
        return job

    @staticmethod
    @transaction.atomic
    def start_job(job: Job) -> None:
        job.status = JobStatus.RUNNING
        job.progress = 0
        job.current_step = "Starting execution"
        job.save()
        
        JobEvent.objects.create(
            job=job,
            event_type='STARTED',
            details={}
        )
        
        JobService.log_message(job, "Job started execution.", 'INFO')
        
        # Log audit trail
        AuditLog.objects.create(
            event_type='JOB_START',
            actor=job.created_by,
            details={
                "job_id": str(job.id),
                "job_type": job.type
            }
        )

    @staticmethod
    @transaction.atomic
    def update_progress(job: Job, progress: int, current_step: str = None) -> None:
        job.progress = progress
        if current_step:
            job.current_step = current_step
        job.save()
        
        JobEvent.objects.create(
            job=job,
            event_type='PROGRESS',
            details={"progress": progress, "step": current_step}
        )
        
        JobService.log_message(job, f"Progress updated to {progress}%: {current_step or ''}", 'INFO')

    @staticmethod
    @transaction.atomic
    def complete_job(job: Job, completion_metadata: dict = None) -> None:
        job.status = JobStatus.COMPLETED
        job.progress = 100
        job.current_step = "Completed"
        if completion_metadata:
            job.completion_metadata = completion_metadata
        job.save()
        
        JobEvent.objects.create(
            job=job,
            event_type='COMPLETED',
            details=completion_metadata or {}
        )
        
        JobService.log_message(job, "Job completed successfully.", 'INFO')
        
        # Log audit trail
        AuditLog.objects.create(
            event_type='JOB_COMPLETE',
            actor=job.created_by,
            details={
                "job_id": str(job.id),
                "job_type": job.type
            }
        )

    @staticmethod
    @transaction.atomic
    def fail_job(job: Job, error_details: str) -> None:
        job.status = JobStatus.FAILED
        job.current_step = "Failed"
        job.error_details = error_details
        job.save()
        
        JobEvent.objects.create(
            job=job,
            event_type='FAILED',
            details={"error": error_details}
        )
        
        JobService.log_message(job, f"Job failed: {error_details}", 'ERROR')
        
        # Log audit trail
        AuditLog.objects.create(
            event_type='JOB_FAIL',
            actor=job.created_by,
            details={
                "job_id": str(job.id),
                "job_type": job.type,
                "error": error_details
            }
        )

    @staticmethod
    @transaction.atomic
    def cancel_job(job: Job) -> None:
        if job.status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
            raise ValidationError(f"Cannot cancel a job in status '{job.status}'.")
            
        job.status = JobStatus.CANCELLED
        job.current_step = "Cancelled"
        job.save()
        
        if job.celery_task_id:
            try:
                from config.celery import app as celery_app
                celery_app.control.revoke(job.celery_task_id, terminate=True)
            except Exception:
                pass

        JobEvent.objects.create(
            job=job,
            event_type='CANCELLED',
            details={}
        )
        
        JobService.log_message(job, "Job cancelled by user.", 'WARNING')

    @staticmethod
    def log_message(job: Job, message: str, level: str = 'INFO') -> None:
        JobLog.objects.create(
            job=job,
            message=message,
            level=level
        )
