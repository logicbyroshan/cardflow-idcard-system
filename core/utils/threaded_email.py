"""
Threaded Email Utility

Sends emails in a background thread so the HTTP response is not blocked
by SMTP round-trips.  Falls back to synchronous sending if the thread
fails to start.

Usage:
    from core.utils.threaded_email import send_mail_async, send_html_email_async

    # Simple text email (fire-and-forget)
    send_mail_async(subject, message, from_email, recipient_list)

    # HTML email with plain-text fallback
    send_html_email_async(subject, plain, html, from_email, recipient_list)

Thread safety: each call spawns a short-lived daemon thread.  Django's
SMTP backend is thread-safe and the GIL makes the spawn overhead negligible
for the low email volume this app produces.
"""

import logging
import threading
from django.core.mail import send_mail, EmailMultiAlternatives

logger = logging.getLogger(__name__)


def send_mail_async(subject, message, from_email, recipient_list,
                    fail_silently=False, **kwargs):
    """
    Drop-in replacement for ``django.core.mail.send_mail`` that runs
    in a daemon thread.  Keyword arguments are forwarded to ``send_mail``.
    """
    def _send():
        try:
            send_mail(
                subject=subject,
                message=message,
                from_email=from_email,
                recipient_list=recipient_list,
                fail_silently=fail_silently,
                **kwargs,
            )
            logger.info("Threaded email sent to %s", recipient_list)
        except Exception as exc:
            logger.error("Threaded email to %s failed: %s", recipient_list, exc)

    t = threading.Thread(target=_send, daemon=False, name='email-send')
    t.start()


def send_html_email_async(subject, plain_content, html_content,
                          from_email, recipient_list):
    """
    Send an HTML email with plain-text fallback in a background thread.
    """
    def _send():
        try:
            msg = EmailMultiAlternatives(
                subject, plain_content, from_email, recipient_list
            )
            msg.attach_alternative(html_content, "text/html")
            msg.send(fail_silently=False)
            logger.info("Threaded HTML email sent to %s", recipient_list)
        except Exception as exc:
            logger.error("Threaded HTML email to %s failed: %s",
                         recipient_list, exc)

    t = threading.Thread(target=_send, daemon=False, name='html-email-send')
    t.start()
