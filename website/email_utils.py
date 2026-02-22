from django.conf import settings
from django.utils import timezone
from core.utils.threaded_email import send_mail_async
import logging

logger = logging.getLogger(__name__)


def send_contact_email(submission):
    """
    Send contact form submission email.
    Returns True if successful, False otherwise.
    """
    try:
        subject = f"[Contact Form] {submission.subject}"
        message = f"""
New contact form submission:

Name: {submission.name}
Email: {submission.email}
Phone: {submission.phone or 'Not provided'}
Subject: {submission.subject}

Message:
{submission.message}

---
Submitted at: {submission.created_at.strftime('%Y-%m-%d %H:%M:%S')}
"""
        
        recipient = getattr(settings, 'CONTACT_FORM_RECIPIENT', '')
        if not recipient:
            logger.error("CONTACT_FORM_RECIPIENT not configured in settings")
            return False
        
        # Send in background thread (non-blocking)
        send_mail_async(
            subject=subject,
            message=message,
            from_email=settings.EMAIL_HOST_USER,
            recipient_list=[recipient],
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
