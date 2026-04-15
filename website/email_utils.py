from django.conf import settings
from django.utils import timezone
from core.utils.threaded_email import send_html_email_async
from core.utils.email_utils import get_contact_submission_email_template
import logging

logger = logging.getLogger(__name__)


def _sanitize_subject(value):
    """Strip CRLF and collapse whitespace for safe email headers."""
    cleaned = str(value or '').replace('\r', ' ').replace('\n', ' ').strip()
    return ' '.join(cleaned.split())[:255]


def send_contact_email(submission):
    """
    Send contact form submission email.
    Returns True if successful, False otherwise.
    """
    try:
        sanitized_subject = _sanitize_subject(getattr(submission, 'subject', '')) or 'No Subject'
        subject = f"[Contact Form] {sanitized_subject}"
        html_content, plain_content = get_contact_submission_email_template(submission)
        
        # Check email backend is configured
        email_backend = getattr(settings, 'EMAIL_BACKEND', '')
        if not email_backend:
            logger.error("EMAIL_BACKEND not configured")
            return False

        recipient = getattr(settings, 'CONTACT_FORM_RECIPIENT', '')
        if not recipient:
            logger.error("CONTACT_FORM_RECIPIENT not configured in settings / .env")
            return False
        
        # Send in background thread (non-blocking)
        send_html_email_async(
            subject=subject,
            plain_content=plain_content,
            html_content=html_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient],
            email_type='contact',
        )
        
        # Mark as sent (email dispatched to thread)
        submission.email_status = 'sent'
        submission.email_sent_at = timezone.now()
        submission.email_last_attempt = timezone.now()
        submission.save()
        
        logger.info(f"Contact email sent successfully for submission {submission.id}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to send contact email for submission {submission.id}: {str(e)}")
        
        # Update retry tracking
        submission.email_last_attempt = timezone.now()
        submission.email_retry_count += 1
        
        # Mark as failed if max retries reached (4 attempts: immediate, 1min, 10min, 1hr, 24hr)
        if submission.email_retry_count >= 4:
            submission.email_status = 'failed'
        
        submission.save()
        return False


def process_pending_emails():
    """
    Process pending emails that need retry.
    Call this from a scheduled task/cron job.
    """
    from .models import ContactSubmission
    
    now = timezone.now()
    pending = ContactSubmission.objects.filter(email_status='pending')
    
    for submission in pending:
        # Skip if no last attempt (will be handled by initial send)
        if not submission.email_last_attempt:
            continue
        
        # Get next retry delay
        delay = submission.get_next_retry_delay()
        
        # If no more retries, mark as failed
        if delay is None:
            submission.email_status = 'failed'
            submission.save()
            continue
        
        # Check if enough time has passed for retry
        time_since_last = (now - submission.email_last_attempt).total_seconds()
        
        if time_since_last >= delay:
            send_contact_email(submission)
